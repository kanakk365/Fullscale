// Scanning, from start to finish: find the earlier scan's place when adding to a room, scan
// the room with live feedback, review it and check a few lengths with a tape, then scan the
// next room or finish. Every room scanned in one go shares one world, so they line up.
import ARKit
import CaptureKit
import SwiftUI

struct ScanFlowView: View {
    @Environment(LibraryStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let request: ScanRequest

    private enum Stage: Equatable {
        case starting, relocalizing, scanning, finishing, review, ending
    }

    @State private var recorder = Recorder()
    @State private var stage = Stage.starting
    /// The library room being scanned, and whether this scan adds to earlier ones.
    @State private var current: (room: String, name: String, adds: Bool)?
    @State private var finished: FinishedRoom?
    @State private var coverage = true
    @State private var bigModel = false
    @State private var confirmFinish = false
    @State private var confirmClose = false
    @State private var choosingNext = false
    @State private var relocalizingSince = Date()
    /// The card saying what an extra scan of a room is for, until it is put away.
    @State private var showFocus = true

    var body: some View {
        ZStack {
            ARCameraView(session: recorder.host.session, showsCoverage: coverage && stage == .scanning)
                .ignoresSafeArea()
            switch stage {
            case .starting:
                Color.black.opacity(0.4).ignoresSafeArea()
                if let problem = recorder.problem {
                    VStack(spacing: 14) {
                        Image(systemName: "exclamationmark.triangle.fill").font(.largeTitle).foregroundStyle(.orange)
                        Text(problem).multilineTextAlignment(.center).foregroundStyle(.white)
                        Button("Close") { dismiss() }.buttonStyle(.borderedProminent)
                    }
                    .padding(28)
                } else {
                    ProgressView("Starting the camera…").tint(.white).foregroundStyle(.white)
                }
            case .relocalizing:
                relocalizingOverlay
            case .scanning:
                hud
            case .finishing:
                Color.black.opacity(0.45).ignoresSafeArea()
                ProgressView("Saving \(current?.name ?? "the room")…").tint(.white).foregroundStyle(.white).font(.headline)
            case .review:
                if let finished {
                    RoomReviewView(
                        finished: finished,
                        recorder: recorder,
                        scanAnother: { choosingNext = true },
                        scanMore: { scanMoreOfFinished() },
                        done: { Task { await end() } }
                    )
                    .transition(.move(edge: .bottom))
                }
            case .ending:
                Color.black.opacity(0.45).ignoresSafeArea()
                ProgressView("Finishing the capture…").tint(.white).foregroundStyle(.white).font(.headline)
            }
        }
        .statusBarHidden(stage == .scanning)
        .task { await start() }
        .onChange(of: recorder.relocalizing) { _, still in
            if stage == .relocalizing, !still {
                Haptics.success()
                beginRoom()
            }
        }
        .onChange(of: recorder.progress.complete) { _, complete in
            if complete, stage == .scanning { Haptics.success() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            recorder.memoryWarning()
        }
        .sheet(isPresented: $choosingNext) {
            if let space = store.library.space(request.space) {
                RoomPickerSheet(space: space, allowExisting: false) { target in
                    choosingNext = false
                    if case .newRoom(let name) = target { startNewRoom(named: name) }
                }
            }
        }
        .confirmationDialog(finishQuestion, isPresented: $confirmFinish, titleVisibility: .visible) {
            Button("Finish anyway") { Task { await finish() } }
            Button("Keep scanning", role: .cancel) {}
        }
        .confirmationDialog("Stop scanning \(current?.name ?? "")?", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("Save what's scanned and stop") {
                Task {
                    await finish()
                    await end()
                }
            }
            Button("Keep scanning", role: .cancel) {}
        }
    }

    // ---------- the flow ----------

    private func start() async {
        guard stage == .starting, let space = store.library.space(request.space) else { return }
        var worldMap: ARWorldMap?
        if case .existing(let roomID) = request.target, let room = space.rooms.first(where: { $0.id == roomID }) {
            worldMap = store.worldMap(continuing: room)
            current = (room.id, room.name, true)
        }
        recorder.startCapture(space: .init(id: space.id, name: space.name), continuing: worldMap)
        if recorder.problem != nil { return }
        if worldMap != nil {
            relocalizingSince = Date()
            stage = .relocalizing
        } else {
            beginRoom()
        }
    }

    /// Start scanning the room the flow was opened for.
    private func beginRoom() {
        switch request.target {
        case .newRoom(let name):
            startNewRoom(named: name)
        case .existing:
            guard let current, let space = store.library.space(request.space), let room = space.rooms.first(where: { $0.id == current.room }) else { return }
            let addsTo = room.latest.map { Manifest.AddsTo(capture: $0.capture, room: $0.room) }
            recorder.startRoom(named: room.name, spaceRoom: .init(id: room.id, name: room.name), addsTo: addsTo)
            stage = .scanning
        }
    }

    private func startNewRoom(named name: String) {
        guard let roomID = store.addRoom(to: request.space, name: name),
              let room = store.library.space(request.space)?.rooms.first(where: { $0.id == roomID }) else { return }
        current = (room.id, room.name, false)
        recorder.startRoom(named: room.name, spaceRoom: .init(id: room.id, name: room.name))
        stage = .scanning
    }

    /// More of the room just finished, in the same world, so it lines up exactly.
    private func scanMoreOfFinished() {
        guard let finished, let current else { return }
        recorder.doneChecking()
        self.current = (current.room, current.name, true)
        recorder.startRoom(named: current.name, spaceRoom: .init(id: current.room, name: current.name), addsTo: .init(capture: finished.capture, room: finished.room))
        stage = .scanning
    }

    private func finish() async {
        guard stage == .scanning, let current else { return }
        stage = .finishing
        guard let done = await recorder.finishRoom() else { return }
        store.record(done, room: current.room, space: request.space, addsToEarlier: current.adds)
        finished = done
        withAnimation { stage = .review }
    }

    private func end() async {
        stage = .ending
        recorder.doneChecking()
        await recorder.endCapture()
        // Nothing was scanned (closed while finding the place): keep no empty capture.
        if recorder.roomCount == 0, let capture = recorder.capturedID { store.deleteCaptures([capture]) }
        dismiss()
    }

    private var finishQuestion: String {
        let missing = recorder.progress.items.filter { $0.state != .done }.map { $0.topic.rawValue }
        return missing.isEmpty ? "Finish \(current?.name ?? "the room")?" : "Not done yet: \(missing.joined(separator: ", ")). Finish anyway?"
    }

    // ---------- what's on screen ----------

    private var relocalizingOverlay: some View {
        ZStack {
            Color.black.opacity(0.35).ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "location.viewfinder").font(.system(size: 44)).foregroundStyle(.white)
                Text("Finding \(current?.name ?? "the room")").font(.title2.weight(.semibold)).foregroundStyle(.white)
                Text("Stand where you started last time and slowly look around the parts you scanned before.")
                    .multilineTextAlignment(.center).foregroundStyle(.white.opacity(0.85))
                ProgressView().tint(.white)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    if context.date.timeIntervalSince(relocalizingSince) > 20 {
                        VStack(spacing: 10) {
                            Text("Still looking. More light and slow movement help.").font(.footnote).foregroundStyle(.white.opacity(0.8))
                            Button("Scan without lining up") {
                                recorder.skipRelocalizing()
                                beginRoom()
                            }
                            .buttonStyle(.bordered).tint(.white)
                            Text("Your computer lines the scans up later instead.").font(.caption2).foregroundStyle(.white.opacity(0.7))
                        }
                    }
                }
            }
            .padding(28)
            .background(.ultraThinMaterial.opacity(0.6), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .padding(24)
        }
        .overlay(alignment: .topLeading) {
            Button { Task { await end() } } label: { Image(systemName: "xmark").font(.headline).padding(12) }
                .tint(.white).background(.black.opacity(0.35), in: Circle()).padding()
        }
    }

    private var hud: some View {
        VStack(spacing: 10) {
            topBar
            coaching
            if current?.adds == true, showFocus { focusCard }
            HStack(alignment: .top) {
                if let notice = recorder.notice {
                    Text(notice).font(.caption).foregroundStyle(.white).padding(8).background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
                }
                Spacer()
                liveModel
            }
            Spacer()
            if let problem = recorder.problem {
                Text(problem).font(.footnote).foregroundStyle(.white).padding(10)
                    .background(.red.opacity(0.75), in: RoundedRectangle(cornerRadius: 12))
            }
            bottomPanel
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private var topBar: some View {
        HStack {
            Button { confirmClose = true } label: { Image(systemName: "xmark").font(.headline).frame(width: 40, height: 40) }
                .background(.black.opacity(0.35), in: Circle())
            Spacer()
            HStack(spacing: 6) {
                Circle().fill(recorder.trackingGood ? Color.green : Color.orange).frame(width: 8, height: 8)
                Text(current?.name ?? "").font(.subheadline.weight(.semibold))
                if let started = recorder.roomStartedAt {
                    Text(started, style: .timer).font(.subheadline.monospacedDigit()).opacity(0.8)
                }
            }
            .padding(.horizontal, 14).frame(height: 40)
            .background(.black.opacity(0.35), in: Capsule())
            Spacer()
            Menu {
                Toggle(isOn: $coverage) { Label("Show what's scanned", systemImage: "square.grid.3x3") }
                Button("Grey-card photo", systemImage: "camera.aperture") { recorder.takeCardPhoto() }
            } label: {
                Image(systemName: "ellipsis").font(.headline).frame(width: 40, height: 40)
            }
            .background(.black.opacity(0.35), in: Circle())
        }
        .foregroundStyle(.white)
    }

    private var coaching: some View {
        let warning = recorder.advice
        let text = warning ?? recorder.progress.next.message
        let symbol = warning != nil ? "exclamationmark.triangle.fill" : recorder.progress.complete ? "checkmark.circle.fill" : "hand.point.up.left.fill"
        let tint: Color = warning != nil ? .orange : recorder.progress.complete ? .green : .white
        return HStack(spacing: 10) {
            Image(systemName: symbol).foregroundStyle(tint).font(.title3)
            Text(text).font(.callout.weight(.medium)).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(.ultraThinMaterial.opacity(0.85), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .environment(\.colorScheme, .dark)
        .animation(.easeInOut, value: text)
    }

    /// An extra scan of a room is for detail: the walls are known already.
    private var focusCard: some View {
        let number = (store.library.space(request.space)?.rooms.first { $0.id == current?.room }?.scans.count ?? 1) + 1
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Scan \(number) of \(current?.name ?? "this room"): add detail").font(.subheadline.weight(.semibold))
                Spacer()
                Button { withAnimation { showFocus = false } } label: { Image(systemName: "xmark").font(.caption.weight(.bold)) }
                    .accessibilityLabel("Put this away")
            }
            Label("Walk close to furniture and along the shelves", systemImage: "figure.walk")
            Label("Look up at the lights, the fan and the ceiling", systemImage: "lightbulb")
            Label("Tap Detail for patterns, pictures and screens", systemImage: "camera.macro")
        }
        .font(.footnote)
        .foregroundStyle(.white)
        .padding(14)
        .background(.ultraThinMaterial.opacity(0.85), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .environment(\.colorScheme, .dark)
        .transition(.opacity)
    }

    private var liveModel: some View {
        let size: CGFloat = bigModel ? 260 : 150
        return RoomModelView(room: recorder.liveRoom, version: recorder.roomVersion, phone: recorder.cameraTransform)
            .frame(width: size, height: size)
            .background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(alignment: .bottomLeading) {
                if recorder.liveRoom == nil {
                    Text("The model appears as walls are found").font(.caption2).foregroundStyle(.white.opacity(0.8)).padding(8)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .onTapGesture { withAnimation(.spring) { bigModel.toggle() } }
            .accessibilityLabel("Live model of the room. Tap to make it bigger or smaller.")
    }

    private var bottomPanel: some View {
        VStack(spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(recorder.progress.items) { item in ChecklistChip(item: item, photos: recorder.photos, details: recorder.details) }
                    if let room = recorder.liveRoom, room.doors.count + room.windows.count > 0 {
                        Text("\(room.doors.count) doors · \(room.windows.count) windows")
                            .font(.caption.weight(.semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 6).background(.black.opacity(0.35), in: Capsule())
                    }
                }
            }
            HStack(spacing: 14) {
                ProgressRing(fraction: recorder.progress.fraction, complete: recorder.progress.complete)
                VStack(alignment: .leading, spacing: 2) {
                    Text(recorder.progress.complete ? "Room complete" : "Scanning").font(.headline).foregroundStyle(.white)
                    Text("\(recorder.photos) photos · \(recorder.keyframes) depth").font(.caption).foregroundStyle(.white.opacity(0.75)).monospacedDigit()
                }
                Spacer()
                Button { recorder.takeDetailPhoto() } label: {
                    Label("Detail", systemImage: "camera.macro").font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .tint(.white)
                .controlSize(.large)
                .accessibilityHint("Takes a sharp close-up of a pattern, picture or screen, for the computer to copy onto the model.")
                Button {
                    if recorder.progress.complete { Task { await finish() } } else { confirmFinish = true }
                } label: {
                    Text("Finish").font(.headline).padding(.horizontal, 10).padding(.vertical, 4)
                }
                .buttonStyle(.borderedProminent)
                .tint(recorder.progress.complete ? .green : .white.opacity(0.25))
                .controlSize(.large)
            }
        }
        .padding(14)
        .background(.ultraThinMaterial.opacity(0.85), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .environment(\.colorScheme, .dark)
    }
}
