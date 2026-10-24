// Checking a capture folder before using or sharing it: the manifest reads, every complete
// index line reads and names files that exist, and the checksums (if written) match. Problems
// are listed in plain words instead of failing at the first one.
import Foundation

public struct BundleCheck: Sendable {
    public var manifest: Manifest?
    public var problems: [String] = []
    /// Complete, readable lines per index file.
    public var records: [String: Int] = [:]

    public var isUsable: Bool { manifest != nil }

    /// The index files a capture may have, and the record each line holds.
    static let indexes: [(path: String, read: @Sendable (Data) throws -> [String])] = [
        ("photos/index.jsonl", { try files(PhotoRecord.self, $0) { [$0.file] } }),
        ("frames/index.jsonl", { try files(KeyframeRecord.self, $0) { [$0.depth.file, $0.confidence.file, $0.rgb.file] } }),
        ("checks/tape.jsonl", { try files(TapeCheckRecord.self, $0) { _ in [] } }),
        ("colour/cards.jsonl", { try files(ColourCardRecord.self, $0) { [$0.photo] } }),
        ("poses/poses.jsonl", { try files(PoseRecord.self, $0) { _ in [] } }),
        ("log/events.jsonl", { try files(EventRecord.self, $0) { _ in [] } }),
    ]

    private static func files<R: Decodable>(_ type: R.Type, _ line: Data, _ named: (R) -> [String]) throws -> [String] {
        named(try CaptureDates.decoder().decode(R.self, from: line))
    }

    public static func check(_ folder: URL) -> BundleCheck {
        var report = BundleCheck()
        do {
            let data = try Data(contentsOf: folder.appendingPathComponent(BundleWriter.manifestFile))
            report.manifest = try CaptureDates.decoder().decode(Manifest.self, from: data)
            if report.manifest?.status != .complete { report.problems.append("The capture did not finish (status \(report.manifest!.status.rawValue)).") }
        } catch {
            report.problems.append("The manifest can't be read: \(error.localizedDescription)")
            return report
        }

        for index in indexes {
            let url = folder.appendingPathComponent(index.path)
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            var count = 0
            let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            for (number, line) in lines.enumerated() where !line.isEmpty {
                let isLast = number == lines.count - 1
                do {
                    for file in try index.read(Data(line.utf8)) {
                        if !CaptureNaming.isSafe(file) || !FileManager.default.fileExists(atPath: folder.appendingPathComponent(file).path) {
                            report.problems.append("\(index.path) line \(number + 1) names a missing or unsafe file: \(file)")
                        }
                    }
                    count += 1
                } catch {
                    // A half-written last line is what a crash leaves; anything else is damage.
                    report.problems.append(isLast ? "\(index.path) ends with an incomplete line (the capture was cut short)." : "\(index.path) line \(number + 1) can't be read.")
                }
            }
            report.records[index.path] = count
        }

        let sums = folder.appendingPathComponent(BundleWriter.checksumsFile)
        if let text = try? String(contentsOf: sums, encoding: .utf8) {
            for line in text.split(separator: "\n") {
                let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
                guard parts.count == 2 else { continue }
                let path = parts[1].trimmingCharacters(in: .whitespaces)
                let actual = CaptureNaming.isSafe(path) ? try? BundleWriter.sha256(of: folder.appendingPathComponent(path)) : nil
                if actual != parts[0] { report.problems.append("\(path) does not match its checksum.") }
            }
        }
        return report
    }
}
