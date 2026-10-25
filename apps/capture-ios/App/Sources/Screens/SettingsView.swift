// Settings: metres or feet, every capture on the phone (to send or delete), and what the app is.
import CaptureKit
import SwiftUI

struct SettingsView: View {
    @Environment(LibraryStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var store = store
        NavigationStack {
            Form {
                Section("Units") {
                    Picker("Lengths", selection: $store.units) {
                        Text("Metres").tag(LengthSystem.metric)
                        Text("Feet and inches").tag(LengthSystem.imperial)
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    NavigationLink("Captures on this phone") { CapturesView() }
                } footer: {
                    Text("Every scan is a capture folder. Send them to your computer with AirDrop and import them in the Fullscale studio.")
                }
                Section("About") {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "–")
                    Link(destination: URL(string: "https://github.com/kanakk365/Fullscale")!) {
                        Label("Fullscale is open source", systemImage: "chevron.left.forwardslash.chevron.right")
                    }
                    Text("Scans stay on this phone until you send them. Nothing is uploaded.").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

/// Every capture folder, checked, with sending and deleting.
struct CapturesView: View {
    @Environment(LibraryStore.self) private var store
    @State private var captures: [URL] = []
    /// What checking each capture found. Checking reads every file, so it runs once per
    /// capture, away from the main thread.
    @State private var checks: [URL: BundleCheck] = [:]
    @State private var sharing: URL?

    var body: some View {
        List {
            if captures.isEmpty {
                Text("None yet.").foregroundStyle(.secondary)
            }
            ForEach(captures, id: \.self) { folder in
                VStack(alignment: .leading, spacing: 4) {
                    Text(folder.lastPathComponent).font(.body.monospaced())
                    if let check = checks[folder] {
                        Text(summary(check)).font(.caption).foregroundStyle(check.problems.isEmpty ? Color.secondary : Color.orange)
                    } else {
                        Text("Checking…").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .swipeActions {
                    Button("Send") { share(folder) }.tint(.blue)
                    Button("Delete", role: .destructive) { delete(folder) }
                }
            }
        }
        .navigationTitle("Captures")
        .onAppear(perform: reload)
        .task(id: captures) {
            for folder in captures where checks[folder] == nil {
                checks[folder] = await Task.detached(priority: .utility) { BundleCheck.check(folder) }.value
            }
        }
        .sheet(item: $sharing) { url in ShareSheet(items: [url]) }
    }

    private func summary(_ check: BundleCheck) -> String {
        guard let manifest = check.manifest else { return "Can't be read" }
        let rooms = manifest.rooms.map(\.name).joined(separator: ", ")
        let space = manifest.space.map { "\($0.name): " } ?? ""
        let problems = check.problems.isEmpty ? "" : " · \(check.problems.count) problem(s)"
        return "\(space)\(rooms.isEmpty ? "no rooms" : rooms) · \(manifest.counts.photos) photos\(problems)"
    }

    private func reload() {
        captures = store.captureFolders()
        checks = checks.filter { captures.contains($0.key) }
    }

    private func share(_ folder: URL) {
        do {
            sharing = try Zipper.zip(folder)
        } catch {
            store.reportProblem("\(folder.lastPathComponent) could not be zipped to send: \(error.localizedDescription)")
        }
    }

    private func delete(_ folder: URL) {
        store.deleteCaptures([folder.lastPathComponent])
        store.load()
        reload()
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

/// A capture folder as a zip, for AirDrop or Files, using the system's own zipping.
enum Zipper {
    static func zip(_ folder: URL) throws -> URL {
        let target = FileManager.default.temporaryDirectory.appendingPathComponent("\(folder.lastPathComponent).zip")
        var coordinating: NSError?
        var copying: (any Error)?
        NSFileCoordinator().coordinate(readingItemAt: folder, options: .forUploading, error: &coordinating) { zipped in
            do {
                // A zip left from sending the same capture before.
                if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
                try FileManager.default.copyItem(at: zipped, to: target)
            } catch {
                copying = error
            }
        }
        if let failure = coordinating ?? copying { throw failure }
        return target
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
