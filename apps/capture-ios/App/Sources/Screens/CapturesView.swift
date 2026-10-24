// The first screen: past captures, to check and share, and a button for a new one.
import CaptureKit
import SwiftUI

struct CapturesView: View {
    @State private var captures: [URL] = []
    /// What checking each capture found. Checking reads every file, so it runs once per
    /// capture, away from the main thread.
    @State private var checks: [URL: BundleCheck] = [:]
    /// The capture being made: a new recorder each time.
    @State private var capture: Recorder?
    @State private var sharing: URL?
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button("New capture") { capture = Recorder() }
                        .font(.headline)
                }
                Section("Captures") {
                    if captures.isEmpty {
                        Text("None yet. Captures stay on this phone until you share them.").foregroundStyle(.secondary)
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
                            Button("Share") { share(folder) }.tint(.blue)
                            Button("Delete", role: .destructive) { delete(folder) }
                        }
                    }
                }
            }
            .navigationTitle("Fullscale")
            .onAppear(perform: reload)
            .task(id: captures) {
                for folder in captures where checks[folder] == nil {
                    checks[folder] = await Task.detached(priority: .utility) { BundleCheck.check(folder) }.value
                }
            }
            .fullScreenCover(item: $capture, onDismiss: reload) { recorder in ScanView().environment(recorder) }
            .sheet(item: $sharing) { url in ShareSheet(items: [url]) }
            .alert("Something went wrong", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
                Button("OK") {}
            } message: {
                Text(problem ?? "")
            }
        }
    }

    private func summary(_ check: BundleCheck) -> String {
        guard let manifest = check.manifest else { return "Can't be read" }
        let rooms = manifest.rooms.map(\.name).joined(separator: ", ")
        let problems = check.problems.isEmpty ? "" : " · \(check.problems.count) problem(s)"
        return "\(rooms.isEmpty ? "No rooms" : rooms) · \(manifest.counts.photos) photos\(problems)"
    }

    private func reload() {
        let folder = Recorder.capturesFolder
        // Before the first capture the folder doesn't exist yet: no captures.
        let found = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        captures = found.filter { $0.hasDirectoryPath }.sorted { $0.lastPathComponent > $1.lastPathComponent }
        checks = checks.filter { captures.contains($0.key) }
    }

    private func share(_ folder: URL) {
        do {
            sharing = try Zipper.zip(folder)
        } catch {
            problem = "\(folder.lastPathComponent) could not be zipped to share: \(error.localizedDescription)"
        }
    }

    private func delete(_ folder: URL) {
        do {
            try FileManager.default.removeItem(at: folder)
        } catch {
            problem = "\(folder.lastPathComponent) could not be deleted: \(error.localizedDescription)"
        }
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
                // A zip left from sharing the same capture before.
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
