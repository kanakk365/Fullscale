// The first screen: the spaces scanned on this phone ("Home", "Office"), each with its rooms.
// The first time, it explains in three steps what the app is for.
import ARKit
import CaptureKit
import SwiftUI

struct LibraryView: View {
    @Environment(LibraryStore.self) private var store
    @State private var creating = false
    @State private var showingSettings = false
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                if store.library.spaces.isEmpty {
                    Welcome()
                } else {
                    LazyVStack(spacing: 14) {
                        ForEach(store.library.spaces.reversed()) { space in
                            NavigationLink(value: space.id) { SpaceCard(space: space) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding()
                }
            }
            .background(Color(.systemGroupedBackground))
            .safeAreaInset(edge: .bottom) {
                if store.library.spaces.isEmpty {
                    Button { creating = true } label: {
                        Text("Create your first space").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding()
                    .background(.bar)
                }
            }
            .navigationTitle("Fullscale")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Settings", systemImage: "gearshape") { showingSettings = true }
                }
                if !store.library.spaces.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("New space", systemImage: "plus") { creating = true }
                    }
                }
            }
            .navigationDestination(for: String.self) { id in SpaceView(spaceID: id) }
            .sheet(isPresented: $creating) {
                NewSpaceSheet { id in path.append(id) }
            }
            .sheet(isPresented: $showingSettings) { SettingsView() }
            .alert("Something went wrong", isPresented: Binding(get: { store.problem != nil }, set: { if !$0 { store.clearProblem() } })) {
                Button("OK") {}
            } message: {
                Text(store.problem ?? "")
            }
        }
    }
}

private struct Welcome: View {
    private let hasLiDAR = ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification)

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Image(systemName: "cube.transparent")
                .font(.system(size: 52, weight: .light))
                .foregroundStyle(Color.brand)
                .padding(.top, 4)
            VStack(alignment: .leading, spacing: 8) {
                Text("Your space, in 3D, at real size").font(.largeTitle.weight(.bold))
                Text("Scan it room by room. Your AI agent turns the scans into a 3D model you can redesign together.")
                    .font(.body).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 18) {
                Step(number: 1, title: "Make a space", text: "Like Home or Office.")
                Step(number: 2, title: "Scan each room", text: "Walk slowly along the walls. The app shows what's covered and tells you when a room is done.")
                Step(number: 3, title: "Send it to your computer", text: "Your agent builds the model there: real sizes, real colours, everything editable.")
            }
            if !hasLiDAR {
                Label("This iPhone has no LiDAR scanner, so scans are photos only and less exact. Pro models give the best results.", systemImage: "info.circle")
                    .font(.callout).foregroundStyle(.secondary).card()
            }
        }
        .padding(24)
    }

    private struct Step: View {
        let number: Int
        let title: String
        let text: String

        var body: some View {
            HStack(alignment: .top, spacing: 14) {
                Text("\(number)").font(.headline).foregroundStyle(.white)
                    .frame(width: 30, height: 30).background(Color.brand, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    Text(text).font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct SpaceCard: View {
    @Environment(LibraryStore.self) private var store
    let space: Library.Space

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: RoomIcon.symbol(for: space.kind))
                .font(.title2).foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(Color.brand.gradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(space.name).font(.title3.weight(.semibold))
                Text(details).font(.subheadline).foregroundStyle(.secondary)
                if !space.rooms.isEmpty {
                    Text(space.rooms.map(\.name).joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
        }
        .card()
        .contentShape(Rectangle())
    }

    private var details: String {
        var parts = [space.rooms.count == 1 ? "1 room" : "\(space.rooms.count) rooms"]
        if let area = space.floorAreaM2 { parts.append(LengthFormat.area(area, store.units)) }
        if let last = space.lastScannedAt { parts.append("scanned \(last.formatted(.relative(presentation: .named)))") }
        return parts.joined(separator: " · ")
    }
}

struct NewSpaceSheet: View {
    @Environment(LibraryStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let created: (String) -> Void
    @State private var name = ""
    @State private var kind = Library.Kind.home

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Kind", selection: $kind) {
                        ForEach(Library.Kind.allCases, id: \.self) { k in
                            Label(Library.defaultName(k), systemImage: RoomIcon.symbol(for: k)).tag(k)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("What is it?")
                }
                Section {
                    TextField(Library.defaultName(kind), text: $name)
                        .textInputAutocapitalization(.words)
                } header: {
                    Text("Name")
                } footer: {
                    Text("You can scan its rooms one at a time, and add to any room later.")
                }
            }
            .navigationTitle("New space")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        let id = store.addSpace(name: name, kind: kind)
                        dismiss()
                        created(id)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
