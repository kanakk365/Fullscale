// A space and its rooms: each room's size at a glance, and the button that starts a scan.
import CaptureKit
import SwiftUI

/// What a scan is for: a new room, or more of a room already scanned.
struct ScanRequest: Identifiable {
    enum Target: Equatable {
        case newRoom(name: String)
        case existing(room: String)
    }

    let id = UUID()
    let space: String
    let target: Target
}

struct SpaceView: View {
    @Environment(LibraryStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let spaceID: String
    @State private var choosing = false
    @State private var scan: ScanRequest?
    @State private var renaming = false
    @State private var newName = ""
    @State private var confirmDelete = false

    var body: some View {
        if let space = store.library.space(spaceID) {
            content(space)
        } else {
            ContentUnavailableView("This space was removed", systemImage: "trash")
        }
    }

    private func content(_ space: Library.Space) -> some View {
        ScrollView {
            VStack(spacing: 14) {
                if space.rooms.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "viewfinder").font(.system(size: 40)).foregroundStyle(Color.brand)
                        Text("No rooms yet").font(.headline)
                        Text("Scan the rooms one at a time. You can always scan more of a room later.")
                            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
                } else {
                    summary(space)
                    ForEach(space.rooms) { room in
                        NavigationLink {
                            RoomView(spaceID: space.id, roomID: room.id)
                        } label: {
                            RoomCard(room: room)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding()
            .padding(.bottom, 80)
        }
        .background(Color(.systemGroupedBackground))
        .safeAreaInset(edge: .bottom) {
            Button { choosing = true } label: {
                Label("Scan a room", systemImage: "viewfinder").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding()
            .background(.bar)
        }
        .navigationTitle(space.name)
        .toolbar {
            Menu("More", systemImage: "ellipsis.circle") {
                Button("Rename", systemImage: "pencil") {
                    newName = space.name
                    renaming = true
                }
                Button("Delete space", systemImage: "trash", role: .destructive) { confirmDelete = true }
            }
        }
        .sheet(isPresented: $choosing) {
            RoomPickerSheet(space: space) { target in
                choosing = false
                scan = ScanRequest(space: space.id, target: target)
            }
        }
        .fullScreenCover(item: $scan) { request in ScanFlowView(request: request) }
        .alert("Rename space", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Save") { store.rename(space: space.id, to: newName) }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete \(space.name) and its scans from this phone?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                store.remove(space: space.id)
                dismiss()
            }
        } message: {
            Text("Scans already sent to your computer stay there.")
        }
    }

    private func summary(_ space: Library.Space) -> some View {
        HStack {
            Stat(label: "Rooms", value: "\(space.rooms.count)")
            Stat(label: "Floor area", value: space.floorAreaM2.map { LengthFormat.area($0, store.units) } ?? "–")
            Stat(label: "Scans", value: "\(space.rooms.reduce(0) { $0 + $1.scans.count })")
        }
        .card()
    }
}

private struct RoomCard: View {
    @Environment(LibraryStore.self) private var store
    let room: Library.Room

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: RoomIcon.symbol(for: room.name))
                .font(.title3).foregroundStyle(Color.brand)
                .frame(width: 44, height: 44)
                .background(Color.brand.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(room.name).font(.headline)
                Text(sizeText).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                Text(scansText).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
        }
        .card()
        .contentShape(Rectangle())
    }

    private var sizeText: String {
        guard let s = room.latest?.summary else { return "Not scanned yet" }
        var parts: [String] = []
        if let l = s.lengthM, let w = s.widthM { parts.append("\(LengthFormat.length(l, store.units)) × \(LengthFormat.length(w, store.units))") }
        if let a = s.floorAreaM2 { parts.append(LengthFormat.area(a, store.units)) }
        return parts.isEmpty ? "\(s.walls) walls" : parts.joined(separator: " · ")
    }

    private var scansText: String {
        guard let last = room.latest else { return "" }
        let count = room.scans.count == 1 ? "1 scan" : "\(room.scans.count) scans"
        return "\(count) · last \(last.scannedAt.formatted(.relative(presentation: .named)))"
    }
}

/// Before scanning: a new room (with names to pick from) or more of a room already scanned.
struct RoomPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let space: Library.Space
    var allowExisting = true
    let chosen: (ScanRequest.Target) -> Void
    @State private var name = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Room name", text: $name)
                        .textInputAutocapitalization(.words)
                        .submitLabel(.go)
                        .onSubmit(startNew)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(Library.suggestedRooms(space.kind), id: \.self) { suggestion in
                                Button(suggestion) { name = suggestion }
                                    .buttonStyle(.bordered)
                                    .buttonBorderShape(.capsule)
                                    .tint(name == suggestion ? .brand : .secondary)
                            }
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    Button("Start scanning", systemImage: "viewfinder", action: startNew)
                        .font(.headline)
                } header: {
                    Text("A new room")
                }
                if allowExisting && !space.rooms.isEmpty {
                    Section {
                        ForEach(space.rooms) { room in
                            Button {
                                chosen(.existing(room: room.id))
                            } label: {
                                Label(room.name, systemImage: RoomIcon.symbol(for: room.name))
                            }
                        }
                    } header: {
                        Text("Scan more of a room")
                    } footer: {
                        Text("Adds to what you scanned before. Start where you scanned last time so the phone can line the two up.")
                    }
                }
            }
            .navigationTitle("What will you scan?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func startNew() {
        chosen(.newRoom(name: name))
    }
}
