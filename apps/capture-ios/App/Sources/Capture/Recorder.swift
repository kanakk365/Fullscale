// One capture, from start to finish: each camera frame goes through CaptureKit's rules (is
// tracking good, keep a depth frame, which photo to keep, when to take a full-resolution
// still), and what is kept is written into the capture folder. All decisions live in
// CaptureKit, where they are tested; this file only moves data between ARKit and CaptureKit.
import ARKit
import CaptureKit
import Foundation
import Observation
import RoomPlan
import UIKit

@MainActor
@Observable
final class Recorder {
    enum Phase: Equatable {
        case idle
        case scanning(room: String)
        case finishingRoom
        case checking(room: String)
        case done
    }

    private(set) var phase: Phase = .idle
    private(set) var photos = 0
    private(set) var stills = 0
    private(set) var cards = 0
    private(set) var keyframes = 0
    private(set) var trackingGood = false
    /// What to do about tracking, when it is not good.
    private(set) var advice: String?
    /// Why the capture is taking fewer photos, when it is.
    private(set) var notice: String?
    private(set) var problem: String?
    private(set) var lastCapture: URL?
    /// Walls and openings the scanner has found in the current room, for tape checks.
    private(set) var scanned: [ScannedElement] = []

    let host = ARHost()
    private let camera = CameraControl()
    private var writer: BundleWriter?
    /// The last write asked for; each write waits for the one before, so the manifest's
    /// changes land in order and the capture finishes only after everything is written.
    private var lastWrite: Task<Void, Never>?
    private var rooms: [Manifest.Room] = []
    private var roomRecord: RoomRecord?
    private var lockWhiteBalance = false
    private var whiteBalanceLost = false
    private var keyframeGate = KeyframeGate()
    private var selector = PhotoSelector()
    private var tracking = TrackingGate()
    private var stillRequests = StillRequests()
    private var stillFor: PhotoCandidate?
    private var previous: (pose: Pose, t: Double)?
    /// The camera's last step, to predict a still's blur from how fast the camera moves.
    private var lastStep: (from: (pose: Pose, t: Double), to: (pose: Pose, t: Double))?
    private var heldImage: (id: String, jpeg: Data, frame: PhotoRecord)?
    private var cardRequested = false
    private var poses: [PoseRecord] = []
    private var lastReason: TrackingReason?
    private var instruction: ScannerInstruction?
    private var lastThermal = ThermalState.nominal
    private var lastSpaceCheck = 0.0
    private var outOfSpace = false
    private var waitingWrites = 0
    private var counter = 0
    private var lastMemoryWarning: Date?
    private let encode = DispatchQueue(label: "fullscale.capture.encode", qos: .userInitiated)

    static var capturesFolder: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Captures", isDirectory: true)
    }

    // ---------- the capture ----------

    /// Start the capture: a new folder, and the camera. A recorder makes one capture.
    func startCapture() {
        guard writer == nil, phase == .idle else { return }
        guard ARWorldTrackingConfiguration.isSupported else {
            problem = "This device can't follow its own movement in 3D, so it can't scan."
            return
        }
        guard CaptureBudget.canStart(freeBytes: Self.freeBytes()) else {
            problem = "The phone needs at least 500 MB free to start a capture."
            return
        }
        var random = SystemRandomNumberGenerator()
        let now = Date()
        var manifest = Manifest(id: CaptureNaming.captureID(at: now, random: &random), createdAt: now, tier: host.hasLiDAR ? 1 : 2)
        manifest.clock = .init(uptimeAtStart: ProcessInfo.processInfo.systemUptime, utcAtStart: now)
        manifest.app = .init(name: "Fullscale", version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0", build: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String)
        manifest.device = .init(model: Self.modelIdentifier(), os: "iOS", osVersion: UIDevice.current.systemVersion, lidar: host.hasLiDAR)
        let format = host.videoFormat
        manifest.ar = .init(
            videoFormat: .init(width: Int(format.imageResolution.width), height: Int(format.imageResolution.height), fps: format.framesPerSecond),
            highResolutionStills: format.isRecommendedForHighResolutionFrameCapturing
        )
        manifest.alignment = .init(method: .first)
        do {
            writer = try BundleWriter(parent: Self.capturesFolder, manifest: manifest)
        } catch {
            problem = "The capture could not be started: \(error.localizedDescription)"
            return
        }
        host.onFrame = { [weak self] frame in self?.handle(frame) }
        host.onRoomUpdate = { [weak self] room in self?.scanned = ScannedElement.list(room) }
        host.onInstruction = { [weak self] asked in self?.instruction = asked }
        host.onFailure = { [weak self] reason in self?.problem = "The camera stopped: \(reason)" }
        host.start()
    }

    func startRoom(named name: String) {
        let id = "r\(rooms.count + 1)"
        let entry = Manifest.Room(id: id, name: name.isEmpty ? "Room \(rooms.count + 1)" : name, dir: "rooms/\(id)", startedAt: Date())
        rooms.append(entry)
        roomRecord = RoomRecord(id: id, name: entry.name, startedAt: entry.startedAt)
        selector = PhotoSelector()
        scanned = []
        // Locked once tracking is good, when the camera has settled on the room's light.
        lockWhiteBalance = true
        whiteBalanceLost = false
        host.startRoom(index: UInt8(rooms.count - 1))
        phase = .scanning(room: entry.name)
        save { $0.rooms.append(entry) }
    }

    func finishRoom() async {
        guard let writer, let entry = rooms.last else { return }
        phase = .finishingRoom
        for kept in selector.flush() { keep(kept) }
        let (data, scannerProblem, mesh) = await host.finishRoom()
        instruction = nil
        camera.unlock()
        if let scannerProblem {
            problem = "The scanner could not finish \(entry.name): \(scannerProblem)"
            log(.scannerFailed, room: entry.id, detail: scannerProblem)
        }
        let encoder = JSONEncoder()
        do {
            if let data {
                // The raw data first: it can be turned into a room layout again later even if
                // building the layout now fails.
                try await writer.write(try encoder.encode(data), at: "\(entry.dir)/roomplan-data.json")
                let layout = try await RoomBuilder(options: [.beautifyObjects]).capturedRoom(from: data)
                try await writer.write(try encoder.encode(layout), at: "\(entry.dir)/roomplan.json")
            }
            let meshData = MeshExport.mesh(from: mesh)
            let url = writer.folder.appendingPathComponent("mesh/session.ply")
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try PLY.write(vertices: meshData.vertices, faces: meshData.faces, to: url)
        } catch {
            problem = "Part of \(entry.name) could not be saved: \(error.localizedDescription)"
            log(.writeFailed, detail: "\(entry.dir): \(error.localizedDescription)")
        }
        let ended = Date()
        roomRecord?.endedAt = ended
        writeRoomRecord()
        save { manifest in
            if let i = manifest.rooms.firstIndex(where: { $0.id == entry.id }) { manifest.rooms[i].endedAt = ended }
        }
        flushPoses()
        phase = .checking(room: entry.id)
    }

    /// A tape check for the room just scanned. Returns how it compares with the scan.
    func addTapeCheck(kind: TapeCheckRecord.Kind, element: String?, scanM: Double?, typed: String, unit: LengthUnit, heldOut: Bool) throws -> TapeBand? {
        guard let entry = rooms.last else { return nil }
        let tapeM = try LengthParser.parse(typed, unit: unit)
        guard TapeGrading.isPlausible(tapeM: tapeM) else { throw LengthError(input: typed, reason: "tape values are between 0.2 and 20 m") }
        counter += 1
        let record = TapeCheckRecord(id: "c\(counter)", room: entry.id, kind: kind, element: element, appM: scanM, tapeM: tapeM, entered: typed, unit: unit.rawValue, heldOut: heldOut, obstructed: false, t: ProcessInfo.processInfo.systemUptime)
        store("a tape check") { try await $0.append(record, to: "checks/tape.jsonl") }
        save { $0.counts.tapeChecks += 1 }
        roomRecord?.counts.tapeChecks += 1
        // The room's record was written when the room ended; write it again with this check.
        writeRoomRecord()
        return scanM.map { TapeGrading.band(scanM: $0, tapeM: tapeM) }
    }

    private func writeRoomRecord() {
        guard let record = roomRecord, let entry = rooms.first(where: { $0.id == record.id }) else { return }
        store("\(entry.name)'s record") { try await $0.write(try CaptureDates.encoder().encode(record), at: "\(entry.dir)/room.json") }
    }

    /// Done with the tape checks; ready for the next room or the end.
    func doneChecking() {
        if case .checking = phase { phase = .idle }
    }

    /// Photograph a grey card on the next good frame: hold it in the room's light, filling the
    /// middle of the picture. The computer uses it to set the room's colours right.
    func takeCardPhoto() {
        guard case .scanning = phase else { return }
        cardRequested = true
    }

    func endCapture() async {
        host.stop()
        camera.unlock()
        // Let depth frames and stills still being encoded reach the writer first.
        let deadline = Date().addingTimeInterval(5)
        while waitingWrites > 0, Date() < deadline { try? await Task.sleep(for: .milliseconds(50)) }
        flushPoses()
        let uptime = ProcessInfo.processInfo.systemUptime
        let now = Date()
        save { manifest in
            manifest.clock?.uptimeAtEnd = uptime
            manifest.clock?.utcAtEnd = now
        }
        await lastWrite?.value
        guard let writer else { return }
        do {
            try await writer.finish()
            lastCapture = writer.folder
        } catch {
            problem = "The capture could not be finished: \(error.localizedDescription)"
        }
        self.writer = nil
        phase = .done
    }

    // ---------- each frame ----------

    private func handle(_ frame: ARFrame) {
        guard writer != nil else { return }
        let pose = FrameData.pose(frame.camera.transform)
        let t = frame.timestamp
        let state = FrameData.tracking(frame.camera.trackingState)
        let reason = FrameData.reason(frame.camera.trackingState)
        let roomID = scanningRoom?.id
        record(pose: pose, t: t, tracking: state)

        for event in tracking.frame(tracking: state, pose: pose, t: t, frameAgeS: ProcessInfo.processInfo.systemUptime - t) {
            switch event {
            case .lost: log(.trackingLost, room: roomID)
            case .resumed: log(.trackingResumed, room: roomID)
            case .jumped(let metres): log(.worldJumped, room: roomID, value: metres)
            }
        }
        if reason != lastReason {
            lastReason = reason
            if let reason { log(.trackingLimited, room: roomID, detail: reason.rawValue) }
        }
        // Set only on change: each set redraws the screen, and this runs 60 times a second.
        if trackingGood != tracking.open { trackingGood = tracking.open }
        let message = TrackingAdvice.message(tracking: state, reason: reason, gateOpen: tracking.open, instruction: scanningRoom == nil ? nil : instruction)
        if advice != message { advice = message }
        checkThermal()
        checkSpace(now: t)

        defer {
            if let previous { lastStep = (previous, (pose, t)) }
            previous = (pose, t)
        }
        guard let room = scanningRoom, tracking.open, !outOfSpace else { return }
        holdWhiteBalance(now: t, room: room)
        if cardRequested {
            cardRequested = false
            writeCard(frame, pose: pose, room: room)
        }

        let budget = CaptureBudget.current(thermal: lastThermal, secondsSinceMemoryWarning: lastMemoryWarning.map { -$0.timeIntervalSinceNow }, photosInRoom: roomRecord?.counts.photos ?? 0)
        let easing = Self.notice(for: budget, thermal: lastThermal)
        if notice != easing { notice = easing }
        keyframeGate.minIntervalS = 1 / budget.depthPerSecond
        if let depth = frame.sceneDepth, keyframeGate.consider(pose: pose, t: t, tracking: .normal, waitingWrites: waitingWrites) == .keep {
            writeKeyframe(frame, depth: depth, pose: pose, room: room)
        }

        guard let previous else { return }
        let intrinsics = FrameData.intrinsics(frame.camera.intrinsics)
        let blur = predictedBlurPx(fx: intrinsics.fx, exposureS: frame.camera.exposureDuration, from: previous, to: (pose, t))
        counter += 1
        let candidate = PhotoCandidate(id: "p\(counter)", pose: pose, t: t, blurPx: blur)
        let kept = selector.offer(candidate)
        if selector.heldID == candidate.id, let jpeg = FrameData.jpeg(frame.capturedImage, quality: 0.9) {
            let size = frame.camera.imageResolution
            let record = PhotoRecord(id: candidate.id, file: "photos/\(candidate.id).jpg", room: room.id, kind: .auto, t: t, width: Int(size.width), height: Int(size.height), pose: pose, intrinsics: intrinsics, tracking: .normal, blurPx: blur, camera: cameraRecord(frame.camera, exif: frame.exifData))
            heldImage = (candidate.id, jpeg, record)
            askForStill(for: candidate, budget: budget)
        }
        for photo in kept { keep(photo) }
    }

    private var scanningRoom: Manifest.Room? {
        guard case .scanning = phase else { return nil }
        return rooms.last
    }

    private func keep(_ photo: PhotoCandidate) {
        guard let held = heldImage, held.id == photo.id else { return }
        heldImage = nil
        photos += 1
        roomRecord?.counts.photos += 1
        store("a photo") { writer in
            try await writer.write(held.jpeg, at: held.frame.file)
            try await writer.append(held.frame, to: "photos/index.jsonl")
        }
        save { $0.counts.photos += 1 }
    }

    // ---------- white balance and grey cards ----------

    private func holdWhiteBalance(now: Double, room: Manifest.Room) {
        if lockWhiteBalance {
            lockWhiteBalance = false
            if let locked = camera.lockForRoom() {
                roomRecord?.whiteBalance = .init(gains: locked.gains, temperatureK: locked.temperatureK, tint: locked.tint, locked: true)
                log(.whiteBalanceLocked, room: room.id, value: locked.temperatureK)
            } else {
                if let reading = camera.reading() {
                    roomRecord?.whiteBalance = .init(gains: reading.gains, temperatureK: reading.temperatureK, tint: reading.tint, locked: false)
                }
                log(.whiteBalanceFailed, room: room.id, detail: "the camera would not lock its white balance")
            }
            return
        }
        if !camera.keepLocked(now: now), !whiteBalanceLost {
            whiteBalanceLost = true
            roomRecord?.whiteBalance?.locked = false
            log(.whiteBalanceFailed, room: room.id, detail: "the lock was undone and could not be put back")
        }
    }

    private func writeCard(_ frame: ARFrame, pose: Pose, room: Manifest.Room) {
        guard let jpeg = FrameData.jpeg(frame.capturedImage, quality: 0.95), let reading = camera.reading(exif: frame.exifData) else {
            problem = "The grey card photo could not be taken. Try again."
            return
        }
        counter += 1
        let id = "k\(counter)"
        let size = frame.camera.imageResolution
        let photo = PhotoRecord(id: id, file: "photos/\(id).jpg", room: room.id, kind: .card, t: frame.timestamp, width: Int(size.width), height: Int(size.height), pose: pose, intrinsics: FrameData.intrinsics(frame.camera.intrinsics), tracking: .normal, blurPx: 0, camera: cameraRecord(frame.camera, exif: frame.exifData))
        let card = ColourCardRecord(id: id, room: room.id, card: "grey-18", photo: photo.file, whiteBalanceGains: reading.gains, temperatureK: reading.temperatureK, tint: reading.tint, iso: reading.iso, exposureS: frame.camera.exposureDuration, evOffset: Double(frame.camera.exposureOffset))
        cards += 1
        roomRecord?.counts.cards += 1
        store("the grey card photo") { writer in
            try await writer.write(jpeg, at: photo.file)
            try await writer.append(photo, to: "photos/index.jsonl")
            try await writer.append(card, to: "colour/cards.jsonl")
        }
        save {
            $0.counts.photos += 1
            $0.counts.cards += 1
        }
    }

    // ---------- full-resolution stills ----------

    private func askForStill(for candidate: PhotoCandidate, budget: CaptureBudget) {
        guard stillRequests.ask(for: candidate.id, now: candidate.t, thermalNominal: lastThermal == .nominal, enabled: budget.stills) else { return }
        stillFor = candidate
        host.captureStill { [weak self] still, error in self?.stillArrived(still, error: error) }
    }

    private func stillArrived(_ still: StillFrame?, error: (any Error)?) {
        let forID = stillRequests.arrived(now: still?.t ?? previous?.t ?? 0)
        let held = stillFor
        stillFor = nil
        guard let still, let room = scanningRoom else {
            if let error { log(.stillFailed, room: scanningRoom?.id, detail: error.localizedDescription) }
            return
        }
        // Too late, or the camera has moved or shaken too much to match the photo.
        guard let held, held.id == forID, let step = lastStep else { return }
        let blur = predictedBlurPx(fx: still.intrinsics.fx, exposureS: still.exposureS, from: step.from, to: step.to)
        guard StillPolicy().accept(stillPose: still.pose, stillBlurPx: blur, stillWidth: Double(still.width), held: held) else { return }

        counter += 1
        let id = "s\(counter)"
        let reading = camera.reading(exif: still.exif)
        let record = PhotoRecord(
            id: id, file: "photos/\(id).jpg", room: room.id, kind: .still, t: still.t, width: still.width, height: still.height,
            pose: still.pose, intrinsics: still.intrinsics, tracking: .normal, blurPx: blur,
            camera: .init(exposureS: still.exposureS, iso: reading?.iso ?? 0, evOffset: still.evOffset, whiteBalanceGains: reading?.gains ?? [], whiteBalanceLocked: reading?.whiteBalanceLocked ?? false, exposureLocked: reading?.exposureLocked ?? false)
        )
        waitingWrites += 1
        encode.async { [weak self] in
            let jpeg = FrameData.jpeg(still.image, quality: 0.92)
            Task { @MainActor in
                guard let self else { return }
                self.waitingWrites -= 1
                guard let jpeg else {
                    self.log(.stillFailed, room: room.id, detail: "the still could not be encoded")
                    return
                }
                self.stills += 1
                self.roomRecord?.counts.stills += 1
                self.store("a full-resolution photo") { writer in
                    try await writer.write(jpeg, at: record.file)
                    try await writer.append(record, to: "photos/index.jsonl")
                }
                self.save { $0.counts.photos += 1 }
            }
        }
    }

    // ---------- depth ----------

    private func writeKeyframe(_ frame: ARFrame, depth: ARDepthData, pose: Pose, room: Manifest.Room) {
        counter += 1
        let id = String(format: "f%06d", counter)
        // Copy what is needed now: holding on to the frame would starve ARKit's buffers.
        let t = frame.timestamp
        let copied = FrameData.depth(depth)
        let rgbSize = frame.camera.imageResolution
        let colour = FrameData.jpeg(frame.capturedImage, quality: 0.8, maxWidth: 640)
        let fullK = FrameData.intrinsics(frame.camera.intrinsics)
        let depthK = fullK.scaled(from: (rgbSize.width, rgbSize.height), to: (Double(copied.width), Double(copied.height)))
        let rgbK = fullK.scaled(from: (rgbSize.width, rgbSize.height), to: (640, 640 * rgbSize.height / rgbSize.width))
        waitingWrites += 1
        encode.async { [weak self] in
            let depthData = try? DepthEncoding.encodeDepth(copied.metres)
            let confidenceData = try? DepthEncoding.encodeConfidence(copied.confidence)
            Task { @MainActor in
                guard let self else { return }
                self.waitingWrites -= 1
                guard let depthData, let confidenceData, let colour else {
                    self.save { $0.counts.depthSkipped.writeFailed += 1 }
                    return
                }
                let record = KeyframeRecord(
                    id: id, t: t, room: room.id, pose: pose,
                    depth: .init(file: "frames/\(id).depth", width: copied.width, height: copied.height, intrinsics: depthK),
                    confidence: .init(file: "frames/\(id).conf"),
                    rgb: .init(file: "frames/\(id).jpg", width: 640, height: Int(640 * rgbSize.height / rgbSize.width), intrinsics: rgbK)
                )
                self.keyframes += 1
                self.roomRecord?.counts.keyframes += 1
                self.store("a depth frame") { writer in
                    try await writer.write(depthData, at: record.depth.file)
                    try await writer.write(confidenceData, at: record.confidence.file)
                    try await writer.write(colour, at: record.rgb.file)
                    try await writer.append(record, to: "frames/index.jsonl")
                }
                self.save { $0.counts.keyframes += 1 }
            }
        }
    }

    // ---------- poses, events and the phone's state ----------

    /// The phone is short of memory: ease off for a while, or the system ends the app.
    func memoryWarning() {
        lastMemoryWarning = Date()
        log(.memoryWarning, room: scanningRoom?.id)
    }

    private func record(pose: Pose, t: Double, tracking: Tracking) {
        poses.append(PoseRecord(t: t, pose: pose, tracking: tracking))
        if poses.count >= 60 { flushPoses() }
    }

    private func flushPoses() {
        guard !poses.isEmpty else { return }
        let batch = poses
        poses = []
        store("the camera path") { try await $0.append(contentsOf: batch, to: "poses/poses.jsonl") }
        save { $0.counts.poses += batch.count }
    }

    private func log(_ kind: EventRecord.Kind, room: String? = nil, detail: String? = nil, value: Double? = nil) {
        let event = EventRecord(t: ProcessInfo.processInfo.systemUptime, kind: kind, room: room, detail: detail, value: value)
        store("the capture's log") { try await $0.append(event, to: "log/events.jsonl") }
    }

    private func checkThermal() {
        let now = Self.thermal()
        guard now != lastThermal else { return }
        lastThermal = now
        log(.thermal, room: scanningRoom?.id, detail: "\(now)")
    }

    /// Every ten seconds, make sure the phone has room for more; stop keeping frames if not.
    private func checkSpace(now: Double) {
        guard now - lastSpaceCheck >= 10 else { return }
        lastSpaceCheck = now
        outOfSpace = CaptureBudget.mustPause(freeBytes: Self.freeBytes())
        if outOfSpace { problem = "The phone is nearly full, so nothing more is being saved. Finish the room and end the capture." }
    }

    /// Run a write in order after the ones before it. A failure is shown and logged, never
    /// lost: the capture goes on, and the person knows something is missing.
    private func store(_ what: String, _ work: @escaping @Sendable (BundleWriter) async throws -> Void) {
        guard let writer else { return }
        let previous = lastWrite
        lastWrite = Task {
            await previous?.value
            do {
                try await work(writer)
            } catch {
                self.problem = "Could not save \(what): \(error.localizedDescription)"
                // Logged directly, not through store(), so a log that can't be written can't
                // loop; if this fails too, the message on screen is the record.
                try? await writer.append(EventRecord(t: ProcessInfo.processInfo.systemUptime, kind: .writeFailed, detail: "\(what): \(error.localizedDescription)"), to: "log/events.jsonl")
            }
        }
    }

    private func save(_ change: @escaping @Sendable (inout Manifest) -> Void) {
        store("the capture's summary") { try await $0.updateManifest(change) }
    }

    private func cameraRecord(_ camera: ARCamera, exif: [String: Any]) -> PhotoRecord.Camera {
        let reading = self.camera.reading(exif: exif)
        return .init(exposureS: camera.exposureDuration, iso: reading?.iso ?? 0, evOffset: Double(camera.exposureOffset), whiteBalanceGains: reading?.gains ?? [], whiteBalanceLocked: reading?.whiteBalanceLocked ?? false, exposureLocked: reading?.exposureLocked ?? false)
    }

    private static func notice(for budget: CaptureBudget, thermal: ThermalState) -> String? {
        guard budget != .normal else { return nil }
        if thermal >= .serious { return "The phone is hot, so fewer photos are taken. Let it cool if you can." }
        return "Taking fewer photos to save memory."
    }

    private static func freeBytes() -> Int64 {
        let values = try? capturesFolder.deletingLastPathComponent().resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage ?? 0
    }

    private static func thermal() -> ThermalState {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: .nominal
        case .fair: .fair
        case .serious: .serious
        default: .critical
        }
    }

    /// The model identifier (e.g. "iPhone18,1"), never the name the owner gave the phone.
    static func modelIdentifier() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { bytes in
            String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
        }
    }
}

extension Recorder: Identifiable {}

/// Something the scanner found that a tape can check: a wall's length, a door's or window's
/// width, with the scanner's identifier so the computer can match the check to the element.
struct ScannedElement: Identifiable, Hashable {
    let id: String
    let label: String
    let kind: TapeCheckRecord.Kind
    let metres: Double

    static func list(_ room: CapturedRoom) -> [ScannedElement] {
        var found: [ScannedElement] = []
        for (i, wall) in room.walls.enumerated() {
            found.append(.init(id: wall.identifier.uuidString, label: "Wall \(i + 1)", kind: .wallLength, metres: Double(wall.dimensions.x)))
        }
        for (i, door) in room.doors.enumerated() {
            found.append(.init(id: door.identifier.uuidString, label: "Door \(i + 1)", kind: .doorWidth, metres: Double(door.dimensions.x)))
        }
        for (i, window) in room.windows.enumerated() {
            found.append(.init(id: window.identifier.uuidString, label: "Window \(i + 1)", kind: .windowWidth, metres: Double(window.dimensions.x)))
        }
        return found
    }
}
