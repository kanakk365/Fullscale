import Foundation
import Testing
@testable import CaptureKit

private func scratch() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("capture-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private func photo(_ id: String) -> PhotoRecord {
    PhotoRecord(id: id, file: "photos/\(id).jpg", room: "r1", kind: .auto, t: 1, width: 1920, height: 1440, pose: .identity, intrinsics: Intrinsics(fx: 1500, fy: 1500, cx: 960, cy: 720), tracking: .normal, blurPx: 1, camera: .init(exposureS: 0.01, iso: 100, evOffset: 0, whiteBalanceGains: [2, 1, 1.8], whiteBalanceLocked: true, exposureLocked: false))
}

@Suite("Writing a capture")
struct StoreTests {
    @Test("a finished capture checks out, with matching checksums")
    func finishedCapture() async throws {
        let writer = try BundleWriter(parent: scratch(), manifest: Manifest(id: "20261024T101200Z-TEST", createdAt: Date(), tier: 1))
        try await writer.write(Data([0xff, 0xd8, 0xff]), at: "photos/p1.jpg")
        try await writer.append(photo("p1"), to: "photos/index.jsonl")
        try await writer.updateManifest { $0.counts.photos = 1 }
        try await writer.finish()
        let report = BundleCheck.check(writer.folder)
        #expect(report.problems.isEmpty)
        #expect(report.records["photos/index.jsonl"] == 1)
        #expect(report.manifest?.status == .complete)
    }

    @Test("a capture cut short keeps every complete line and says it was cut short")
    func cutShort() async throws {
        let writer = try BundleWriter(parent: scratch(), manifest: Manifest(id: "20261024T101200Z-CUT1", createdAt: Date(), tier: 1))
        try await writer.write(Data([1]), at: "photos/p1.jpg")
        try await writer.append(photo("p1"), to: "photos/index.jsonl")
        // What a crash mid-write leaves: half a line, and no "complete".
        let index = writer.folder.appendingPathComponent("photos/index.jsonl")
        let handle = try FileHandle(forWritingTo: index)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data(#"{"id":"p2","fi"#.utf8))
        try handle.close()
        let report = BundleCheck.check(writer.folder)
        #expect(report.records["photos/index.jsonl"] == 1)
        #expect(report.problems.contains { $0.contains("did not finish") })
        #expect(report.problems.contains { $0.contains("incomplete line") })
    }

    @Test("a file changed after finishing fails its checksum")
    func tampered() async throws {
        let writer = try BundleWriter(parent: scratch(), manifest: Manifest(id: "20261024T101200Z-SUM1", createdAt: Date(), tier: 1))
        try await writer.write(Data([1, 2, 3]), at: "mesh/session.ply")
        try await writer.finish()
        try Data([9]).write(to: writer.folder.appendingPathComponent("mesh/session.ply"))
        #expect(BundleCheck.check(writer.folder).problems.contains { $0.contains("mesh/session.ply does not match") })
    }

    @Test("appends many records with one write, and checks the pose and event logs")
    func batches() async throws {
        let writer = try BundleWriter(parent: scratch(), manifest: Manifest(id: "20261024T101200Z-POSE", createdAt: Date(), tier: 1))
        let poses = (0..<120).map { PoseRecord(t: Double($0) / 60, pose: .identity, tracking: .normal) }
        try await writer.append(contentsOf: Array(poses[..<60]), to: "poses/poses.jsonl")
        try await writer.append(contentsOf: Array(poses[60...]), to: "poses/poses.jsonl")
        try await writer.append(EventRecord(t: 1, kind: .trackingLost, room: "r1"), to: "log/events.jsonl")
        try await writer.finish()
        let report = BundleCheck.check(writer.folder)
        #expect(report.problems.isEmpty)
        #expect(report.records["poses/poses.jsonl"] == 120)
        #expect(report.records["log/events.jsonl"] == 1)
    }

    @Test("finds a grey card record whose photo is missing")
    func missingCardPhoto() async throws {
        let writer = try BundleWriter(parent: scratch(), manifest: Manifest(id: "20261024T101200Z-CARD", createdAt: Date(), tier: 1))
        let card = ColourCardRecord(id: "k1", room: "r1", card: "grey-18", photo: "photos/k1.jpg", whiteBalanceGains: [2, 1, 1.8], temperatureK: 4100, tint: 2, iso: 200, exposureS: 0.02, evOffset: 0)
        try await writer.append(card, to: "colour/cards.jsonl")
        try await writer.finish()
        #expect(BundleCheck.check(writer.folder).problems.contains { $0.contains("missing or unsafe file: photos/k1.jpg") })
    }

    @Test("refuses paths that leave the capture, and writes after finishing")
    func refusals() async throws {
        let writer = try BundleWriter(parent: scratch(), manifest: Manifest(id: "20261024T101200Z-SAFE", createdAt: Date(), tier: 1))
        await #expect(throws: BundleError.unsafePath("../outside.txt")) { try await writer.write(Data(), at: "../outside.txt") }
        try await writer.finish()
        await #expect(throws: BundleError.finished) { try await writer.write(Data(), at: "late.txt") }
    }
}
