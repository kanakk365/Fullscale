// Scanning: the camera view, how the capture is going, and the steps of a room — start it,
// walk around, finish it, check a few lengths with a tape.
import ARKit
import CaptureKit
import SwiftUI

struct ScanView: View {
    @Environment(Recorder.self) private var recorder
    @Environment(\.dismiss) private var dismiss
    @State private var roomName = ""

    var body: some View {
        ZStack(alignment: .bottom) {
            CameraView(session: recorder.host.session).ignoresSafeArea()
            VStack(spacing: 12) {
                status
                controls
            }
            .padding()
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
            .padding()
        }
        .onAppear { recorder.startCapture() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            recorder.memoryWarning()
        }
        .sheet(isPresented: Binding(get: { if case .checking = recorder.phase { true } else { false } }, set: { shown in if !shown { recorder.doneChecking() } })) {
            TapeCheckView().environment(recorder)
        }
    }

    private var status: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Label(recorder.trackingGood ? "Tracking" : "Not tracking", systemImage: recorder.trackingGood ? "checkmark.circle" : "exclamationmark.triangle")
                    .foregroundStyle(recorder.trackingGood ? .green : .orange)
                Spacer()
                Text(counts).font(.caption.monospacedDigit())
            }
            if let advice = recorder.advice {
                Text(advice).font(.callout).foregroundStyle(.orange)
            }
            if let notice = recorder.notice {
                Text(notice).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var counts: String {
        var parts = ["\(recorder.photos) photos", "\(recorder.keyframes) depth"]
        if recorder.stills > 0 { parts.insert("\(recorder.stills) full-size", at: 1) }
        if recorder.cards > 0 { parts.append("\(recorder.cards) card") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private var controls: some View {
        if let problem = recorder.problem {
            Text(problem).font(.caption).foregroundStyle(.red)
        }
        switch recorder.phase {
        case .idle, .checking:
            TextField("Room name, e.g. Kitchen", text: $roomName)
                .textFieldStyle(.roundedBorder)
            HStack {
                Button("Start room") {
                    recorder.startRoom(named: roomName)
                    roomName = ""
                }
                .buttonStyle(.borderedProminent)
                Button("End capture") {
                    Task {
                        await recorder.endCapture()
                        dismiss()
                    }
                }
            }
        case .scanning(let room):
            Text("Scanning \(room): walk slowly along the walls, then look at the floor and ceiling.").font(.callout)
            HStack {
                Button("Finish \(room)") { Task { await recorder.finishRoom() } }
                    .buttonStyle(.borderedProminent)
                // A grey card in the room's light lets the computer set the room's colours
                // right. Optional.
                Button("Grey card photo", systemImage: "camera.aperture") { recorder.takeCardPhoto() }
            }
        case .finishingRoom:
            ProgressView("Saving the room…")
        case .done:
            Button("Close") { dismiss() }
        }
    }
}

/// The live camera picture of the shared AR session.
struct CameraView: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.session = session
        view.automaticallyUpdatesLighting = true
        return view
    }

    func updateUIView(_ view: ARSCNView, context: Context) {}
}
