// A room: its 3D model to turn round, its sizes, the tape checks, and every scan of it, with
// the buttons to scan more and to send the scans to a computer.
import CaptureKit
import RoomPlan
import SwiftUI

struct RoomView: View {
    @Environment(LibraryStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let spaceID: String
    let roomID: String
    @State private var layout: CapturedRoom?
    @State private var checks: [TapeCheckRecord] = []
    @State private var scan: ScanRequest?
    @State private var sharing: URL?
    @State private var renaming = false
    @State private var newName = ""
    @State private var confirmDelete = false

    var body: some View {
        if let space = store.library.space(spaceID), let room = space.rooms.first(where: { $0.id == roomID }) {
            content(room)
        } else {
            ContentUnavailableView("This room was removed", systemImage: "trash")
        }
    }

    private func content(_ room: Library.Room) -> some View {
        ScrollView {
            VStack(spacing: 14) {
                model
                if let s = room.latest?.summary { sizes(s) }
                if !checks.isEmpty { tape }
                scans(room)
            }
            .padding()
            .padding(.bottom, 80)
        }
        .background(Color(.systemGroupedBackground))
        .safeAreaInset(edge: .bottom) {
            Button { scan = ScanRequest(space: spaceID, target: .existing(room: roomID)) } label: {
                Label("Scan more", systemImage: "plus.viewfinder").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding()
            .background(.bar)
        }
        .navigationTitle(room.name)
        .toolbar {
            Menu("More", systemImage: "ellipsis.circle") {
                Button("Rename", systemImage: "pencil") {
                    newName = room.name
                    renaming = true
                }
                Button("Delete room", systemImage: "trash", role: .destructive) { confirmDelete = true }
            }
        }
        .task(id: room.latest?.capture) { load(room) }
        .fullScreenCover(item: $scan, onDismiss: { load(room) }) { request in ScanFlowView(request: request) }
        .sheet(item: $sharing) { url in ShareSheet(items: [url]) }
        .alert("Rename room", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Save") { store.rename(room: roomID, in: spaceID, to: newName) }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete \(room.name) and its scans from this phone?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                store.remove(room: roomID, in: spaceID)
                dismiss()
            }
        } message: {
            Text("Scans already sent to your computer stay there.")
        }
    }

    @ViewBuilder private var model: some View {
        ZStack(alignment: .bottomTrailing) {
            if let layout {
                RoomModelView(room: layout, interactive: true)
            } else {
                ContentUnavailableView("No 3D layout", systemImage: "cube.transparent", description: Text("This scan has no room layout. The photos and depth are still there for the computer."))
            }
            if layout != nil {
                Label("Drag to turn", systemImage: "hand.draw").font(.caption2).padding(8).foregroundStyle(.secondary)
            }
        }
        .frame(height: 300)
        .background(Color.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func sizes(_ s: RoomSummary) -> some View {
        VStack(spacing: 14) {
            HStack {
                Stat(label: "Floor area", value: s.floorAreaM2.map { LengthFormat.area($0, store.units) } ?? "–")
                Stat(label: "Ceiling", value: s.heightM.map { LengthFormat.length($0, store.units) } ?? "–")
            }
            HStack {
                Stat(label: "Length × width", value: s.lengthM.flatMap { l in s.widthM.map { "\(LengthFormat.length(l, store.units)) × \(LengthFormat.length($0, store.units))" } } ?? "–")
            }
            Divider()
            HStack {
                Stat(label: "Walls", value: "\(s.walls)")
                Stat(label: "Doors", value: "\(s.doors)")
                Stat(label: "Windows", value: "\(s.windows)")
                Stat(label: "Furniture", value: "\(s.objects)")
            }
        }
        .card()
    }

    private var tape: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Tape checks").font(.headline)
            ForEach(checks, id: \.id) { check in
                HStack {
                    Text(label(check.kind))
                    Spacer()
                    Text(LengthFormat.length(check.tapeM, store.units)).monospacedDigit()
                    if let scanM = check.appM {
                        let band = TapeGrading.band(scanM: scanM, tapeM: check.tapeM)
                        Text(LengthFormat.difference(scanM - check.tapeM, store.units))
                            .font(.caption.weight(.semibold)).monospacedDigit()
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(band.colour.opacity(0.18), in: Capsule())
                            .foregroundStyle(band.colour)
                    }
                }
            }
            Text("How far the scan is from your tape. Green is within 1% and 2 cm.").font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func scans(_ room: Library.Room) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Scans").font(.headline)
            ForEach(Array(room.scans.enumerated().reversed()), id: \.offset) { _, s in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.scannedAt.formatted(date: .abbreviated, time: .shortened))
                        Text(s.addsToEarlier ? "Added to the earlier scan" : "\(s.summary?.photos ?? 0) photos")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Send", systemImage: "square.and.arrow.up") { share(s.capture) }
                        .labelStyle(.iconOnly)
                }
            }
            Text("Send a scan to your computer with AirDrop, then import it in the studio.").font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func load(_ room: Library.Room) {
        guard let latest = room.latest else { return }
        layout = store.layout(of: latest)
        checks = room.scans.flatMap { store.tapeChecks(of: $0) }
    }

    private func share(_ capture: String) {
        do {
            sharing = try Zipper.zip(store.folder(of: capture))
        } catch {
            store.reportProblem("The scan could not be prepared for sending: \(error.localizedDescription)")
        }
    }

    private func label(_ kind: TapeCheckRecord.Kind) -> String {
        switch kind {
        case .wallLength: "Wall"
        case .doorWidth: "Door width"
        case .doorHeight: "Door height"
        case .windowWidth: "Window width"
        case .ceilingHeight: "Ceiling height"
        case .diagonal: "Diagonal"
        case .other: "Other"
        }
    }
}

extension TapeBand {
    var colour: Color {
        switch self {
        case .green: .green
        case .amber: .orange
        case .red: .red
        }
    }
}
