// The one AR session for a whole capture, with Apple's room scanner (RoomPlan) attached to
// it, so every room shares one world and lines up without any work afterwards.
//
// Two things that are not documented but matter (check them on each iOS release):
// - Starting the room scanner reconfigures the session without LiDAR depth or the mesh, so
//   while scanning, the configuration is re-applied with them every half second — never
//   with reset options, which would throw the world away.
// - Stopping a room reconfigures the session too and drops the mesh, so the mesh is copied
//   out before the room stops.
import ARKit
import CaptureKit
import RoomPlan

@MainActor
final class ARHost: NSObject {
    let session = ARSession()
    let hasLiDAR = ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification)

    /// Every camera frame, on the main thread.
    var onFrame: ((ARFrame) -> Void)?
    /// The scanner's latest idea of the room.
    var onRoomUpdate: ((CapturedRoom) -> Void)?
    /// What the scanner asks of the person.
    var onInstruction: ((ScannerInstruction) -> Void)?
    /// The AR session stopped for good, with ARKit's reason.
    var onFailure: ((String) -> Void)?

    private var roomSession: RoomCaptureSession?
    private var keepAlive: Timer?
    private var finishing: CheckedContinuation<(data: CapturedRoomData?, problem: String?), Never>?
    /// The latest copy of each mesh anchor, and the room it was last seen in.
    private(set) var meshAnchors: [UUID: (anchor: ARMeshAnchor, room: UInt8)] = [:]
    private var currentRoom: UInt8 = 255

    func start() {
        session.delegate = self
        session.run(configuration())
    }

    func stop() {
        keepAlive?.invalidate()
        session.pause()
    }

    /// The camera picture's size and rate. With a format recommended for it, stills come at
    /// the camera's full resolution; with others they may be smaller.
    var videoFormat: ARConfiguration.VideoFormat { (session.configuration ?? configuration()).videoFormat }

    /// Ask for one full-resolution still. `done` runs on the main thread.
    func captureStill(_ done: @escaping @MainActor @Sendable (StillFrame?, (any Error)?) -> Void) {
        // Marked @Sendable so it is not taken to run on the main thread: ARKit does not say
        // which thread it answers on.
        session.captureHighResolutionFrame { @Sendable frame, error in
            let still = frame.map(StillFrame.init)
            DispatchQueue.main.async { MainActor.assumeIsolated { done(still, error) } }
        }
    }

    private func configuration() -> ARWorldTrackingConfiguration {
        let config = ARWorldTrackingConfiguration()
        if hasLiDAR {
            config.sceneReconstruction = .meshWithClassification
            config.frameSemantics.insert(.sceneDepth)
        }
        return config
    }

    // ---------- rooms ----------

    /// Start scanning a room. Without LiDAR there is no room scanner: the capture records
    /// tracking and photos only.
    func startRoom(index: UInt8) {
        currentRoom = index
        guard hasLiDAR else { return }
        let scanner = RoomCaptureSession(arSession: session)
        scanner.delegate = self
        roomSession = scanner
        scanner.run(configuration: RoomCaptureSession.Configuration())
        keepAlive?.invalidate()
        keepAlive = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.restoreDepthAndMesh() }
        }
    }

    private func restoreDepthAndMesh() {
        guard let current = session.configuration as? ARWorldTrackingConfiguration else { return }
        guard current.sceneReconstruction != .meshWithClassification || !current.frameSemantics.contains(.sceneDepth) else { return }
        guard let config = current.copy() as? ARWorldTrackingConfiguration else { return }
        config.sceneReconstruction = .meshWithClassification
        config.frameSemantics.insert(.sceneDepth)
        // A carried-over world map would restart relocalisation; the world is already here.
        config.initialWorldMap = nil
        session.run(config)
    }

    /// Finish the room: copy the mesh first, then stop the scanner (keeping the AR session
    /// for the next room) and wait for its raw data, or for why it has none.
    func finishRoom() async -> (data: CapturedRoomData?, problem: String?, mesh: [(anchor: ARMeshAnchor, room: UInt8)]) {
        keepAlive?.invalidate()
        let mesh = Array(meshAnchors.values)
        guard let scanner = roomSession else { return (nil, nil, mesh) }
        let ended = await withCheckedContinuation { continuation in
            finishing = continuation
            scanner.stop(pauseARSession: false)
        }
        roomSession = nil
        currentRoom = 255
        return (ended.data, ended.problem, mesh)
    }
}

extension ARHost: ARSessionDelegate {
    nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
        MainActor.assumeIsolated { onFrame?(frame) }
    }

    nonisolated func session(_ session: ARSession, didFailWithError error: any Error) {
        let reason = error.localizedDescription
        MainActor.assumeIsolated { onFailure?(reason) }
    }

    nonisolated func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
        MainActor.assumeIsolated { keep(anchors) }
    }

    nonisolated func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        MainActor.assumeIsolated { keep(anchors) }
    }

    // Removals are ignored on purpose: the scanner removes anchors when it reconfigures, and
    // the mesh must survive that.

    private func keep(_ anchors: [ARAnchor]) {
        for case let mesh as ARMeshAnchor in anchors {
            meshAnchors[mesh.identifier] = (mesh, currentRoom)
        }
    }
}

// The scanner does not say which thread it calls on, so each call hops to the main thread.
extension ARHost: RoomCaptureSessionDelegate {
    nonisolated func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom) {
        Task { @MainActor in self.onRoomUpdate?(room) }
    }

    nonisolated func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction) {
        let asked = Self.instruction(instruction)
        Task { @MainActor in self.onInstruction?(asked) }
    }

    nonisolated func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: (any Error)?) {
        // The scanner's own words: "the device is too hot", "the room is too big"…
        let problem = error?.localizedDescription
        Task { @MainActor in
            self.finishing?.resume(returning: (problem == nil ? data : nil, problem))
            self.finishing = nil
        }
    }

    private nonisolated static func instruction(_ instruction: RoomCaptureSession.Instruction) -> ScannerInstruction {
        switch instruction {
        case .moveCloseToWall: .moveCloseToWall
        case .moveAwayFromWall: .moveAwayFromWall
        case .slowDown: .slowDown
        case .turnOnLight: .turnOnLight
        case .lowTexture: .lowTexture
        default: .normal
        }
    }
}
