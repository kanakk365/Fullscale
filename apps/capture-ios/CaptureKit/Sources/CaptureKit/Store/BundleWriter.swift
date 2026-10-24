// Writing a capture folder so a crash, a full disk or a killed app never leaves it unreadable.
// - The manifest is replaced atomically (written beside it, then renamed over it).
// - A record line is appended to its index only after the files it names are written and
//   synced, so every complete line points at complete files.
// - At the end, checksums.sha256 lists every file and the manifest says "complete".
// One actor owns the folder, so writes from different queues never interleave.
import CryptoKit
import Foundation

public enum BundleError: Error, Equatable, CustomStringConvertible {
    case unsafePath(String)
    case alreadyExists(String)
    case finished

    public var description: String {
        switch self {
        case .unsafePath(let p): "The path \"\(p)\" would leave the capture folder."
        case .alreadyExists(let p): "A capture already exists at \(p)."
        case .finished: "The capture is already finished."
        }
    }
}

public actor BundleWriter {
    public static let manifestFile = "manifest.json"
    public static let checksumsFile = "checksums.sha256"

    public nonisolated let folder: URL
    public private(set) var manifest: Manifest
    private var finished = false
    private let encoder = CaptureDates.encoder()

    /// Start a capture in a new folder named after the manifest's id, inside `parent`.
    public init(parent: URL, manifest: Manifest) throws {
        folder = parent.appendingPathComponent(manifest.id, isDirectory: true)
        if FileManager.default.fileExists(atPath: folder.path) { throw BundleError.alreadyExists(folder.path) }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var started = manifest
        started.status = .recording
        self.manifest = started
        try Self.writeAtomically(try encoder.encode(started), to: folder.appendingPathComponent(Self.manifestFile))
    }

    /// Write a whole file (a photo, a depth frame) atomically.
    public func write(_ data: Data, at path: String) throws {
        try ensureOpen()
        try Self.writeAtomically(data, to: try url(for: path))
    }

    /// Append one record to an index (e.g. "photos/index.jsonl"), after its files exist.
    public func append<Record: Encodable>(_ record: Record, to index: String) throws {
        try append(contentsOf: [record], to: index)
    }

    /// Append many records at once with one sync, for records that come many times a
    /// second (poses).
    public func append<Record: Encodable>(contentsOf records: [Record], to index: String) throws {
        try ensureOpen()
        guard !records.isEmpty else { return }
        let target = try url(for: index)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: target.path) { FileManager.default.createFile(atPath: target.path, contents: nil) }
        var lines = Data()
        for record in records {
            lines.append(try encoder.encode(record))
            lines.append(0x0a)
        }
        let handle = try FileHandle(forWritingTo: target)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: lines)
        try handle.synchronize()
    }

    /// Change the manifest (a room started or ended, counts) and save it.
    public func updateManifest(_ change: @Sendable (inout Manifest) -> Void) throws {
        try ensureOpen()
        change(&manifest)
        try Self.writeAtomically(try encoder.encode(manifest), to: folder.appendingPathComponent(Self.manifestFile))
    }

    /// Finish: checksums for every file, then the manifest's final status.
    public func finish(status: Manifest.Status = .complete, at date: Date = Date()) throws {
        try ensureOpen()
        manifest.status = status
        manifest.endedAt = date
        try Self.writeAtomically(try encoder.encode(manifest), to: folder.appendingPathComponent(Self.manifestFile))
        let lines = try Self.files(in: folder).filter { $0 != Self.checksumsFile }.map { path in
            "\(try Self.sha256(of: folder.appendingPathComponent(path)))  \(path)"
        }
        try Self.writeAtomically(Data((lines.joined(separator: "\n") + "\n").utf8), to: folder.appendingPathComponent(Self.checksumsFile))
        finished = true
    }

    private func ensureOpen() throws {
        if finished { throw BundleError.finished }
    }

    private func url(for path: String) throws -> URL {
        guard CaptureNaming.isSafe(path) else { throw BundleError.unsafePath(path) }
        return folder.appendingPathComponent(path)
    }

    static func writeAtomically(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    /// Every file in a folder, as sorted relative paths with "/".
    static func files(in folder: URL) throws -> [String] {
        let base = folder.standardizedFileURL.path
        guard let walker = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.isRegularFileKey]) else { return [] }
        var found: [String] = []
        for case let url as URL in walker where (try url.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true {
            found.append(String(url.standardizedFileURL.path.dropFirst(base.count + 1)))
        }
        return found.sorted()
    }

    static func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
