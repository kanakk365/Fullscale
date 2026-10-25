// The library on this phone: spaces and their rooms (CaptureKit's Library), saved as JSON next
// to the captures. Captures are the record; the library only organises them, so a library
// that can't be read is set aside, never overwritten, and the captures are untouched.
import ARKit
import CaptureKit
import Foundation
import Observation
import RoomPlan

@MainActor
@Observable
final class LibraryStore {
    private(set) var library = Library()
    private(set) var problem: String?
    /// Metres or feet and inches, for every length the app shows.
    var units: LengthSystem {
        didSet { UserDefaults.standard.set(units.rawValue, forKey: "units") }
    }

    static var folder: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    static var file: URL { folder.appendingPathComponent("library.json") }

    init() {
        let saved = UserDefaults.standard.string(forKey: "units").flatMap(LengthSystem.init(rawValue:))
        units = saved ?? (Locale.current.measurementSystem == .us ? .imperial : .metric)
        load()
    }

    // ---------- reading and saving ----------

    func load() {
        guard let data = try? Data(contentsOf: Self.file) else { return }
        do {
            library = try CaptureDates.decoder().decode(Library.self, from: data)
        } catch {
            // Keep the unreadable file for later and start a fresh library: the captures
            // themselves are safe in their own folders.
            let aside = Self.folder.appendingPathComponent("library-unreadable-\(Int(Date().timeIntervalSince1970)).json")
            try? FileManager.default.moveItem(at: Self.file, to: aside)
            problem = "The list of spaces couldn't be read, so it was set aside (\(aside.lastPathComponent)). Your captures are safe."
        }
        let existing = Set(captureFolders().map(\.lastPathComponent))
        library.keepOnly(captures: existing)
    }

    private func save() {
        do {
            let data = try CaptureDates.encoder().encode(library)
            try data.write(to: Self.file, options: .atomic)
        } catch {
            problem = "The list of spaces couldn't be saved: \(error.localizedDescription)"
        }
    }

    // ---------- changes ----------

    @discardableResult
    func addSpace(name: String, kind: Library.Kind) -> String {
        let id = library.addSpace(name: name, kind: kind, now: Date())
        save()
        return id
    }

    @discardableResult
    func addRoom(to space: String, name: String) -> String? {
        do {
            let id = try library.addRoom(to: space, name: name, now: Date())
            save()
            return id
        } catch {
            problem = String(describing: error)
            return nil
        }
    }

    func record(_ finished: FinishedRoom, room: String, space: String, addsToEarlier: Bool) {
        let scan = Library.Scan(capture: finished.capture, room: finished.room, scannedAt: Date(), addsToEarlier: addsToEarlier, summary: finished.summary)
        do {
            try library.record(scan, room: room, space: space)
            save()
        } catch {
            problem = String(describing: error)
        }
    }

    func rename(space: String, to name: String) {
        try? library.rename(space: space, to: name)
        save()
    }

    func rename(room: String, in space: String, to name: String) {
        try? library.rename(room: room, in: space, to: name)
        save()
    }

    /// Removes the space and the captures only it used.
    func remove(space: String) {
        guard let unused = try? library.removeSpace(space) else { return }
        deleteCaptures(unused)
        save()
    }

    func remove(room: String, in space: String) {
        guard let unused = try? library.removeRoom(room, in: space) else { return }
        deleteCaptures(unused)
        save()
    }

    func clearProblem() { problem = nil }

    func reportProblem(_ text: String) { problem = text }

    // ---------- captures ----------

    static var capturesFolder: URL { Recorder.capturesFolder }

    func captureFolders() -> [URL] {
        let found = (try? FileManager.default.contentsOfDirectory(at: Self.capturesFolder, includingPropertiesForKeys: nil)) ?? []
        return found.filter(\.hasDirectoryPath).sorted { $0.lastPathComponent > $1.lastPathComponent }
    }

    func folder(of capture: String) -> URL { Self.capturesFolder.appendingPathComponent(capture, isDirectory: true) }

    /// The saved map of the capture that last scanned the room, to continue it.
    func worldMap(continuing room: Library.Room) -> ARWorldMap? {
        guard let capture = room.latest?.capture,
              let data = try? Data(contentsOf: folder(of: capture).appendingPathComponent("worldmap.arworldmap"))
        else { return nil }
        return ARHost.worldMap(from: data)
    }

    /// The scanner's layout of a room in a capture, for the room screen's model.
    func layout(of scan: Library.Scan) -> CapturedRoom? {
        RoomShape.read(folder(of: scan.capture), room: scan.room)
    }

    /// Tape checks typed for a room in a capture.
    func tapeChecks(of scan: Library.Scan) -> [TapeCheckRecord] {
        let file = folder(of: scan.capture).appendingPathComponent("checks/tape.jsonl")
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        let decoder = CaptureDates.decoder()
        return text.split(separator: "\n").compactMap { try? decoder.decode(TapeCheckRecord.self, from: Data($0.utf8)) }.filter { $0.room == scan.room }
    }

    func deleteCaptures(_ captures: Set<String>) {
        for capture in captures {
            do {
                try FileManager.default.removeItem(at: folder(of: capture))
            } catch {
                problem = "\(capture) could not be deleted: \(error.localizedDescription)"
            }
        }
    }
}
