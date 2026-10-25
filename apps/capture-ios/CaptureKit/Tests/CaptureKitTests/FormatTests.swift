import Foundation
import Testing
@testable import CaptureKit

@Suite("The capture format")
struct FormatTests {
    @Test("reads a manifest written by hand from the format document")
    func readsTheDocumentedManifest() throws {
        let json = """
        {"format":"fullscale-capture/1","revision":1,"id":"20261024T101200Z-7KQ2","status":"complete",
         "createdAt":"2026-10-24T10:12:00Z","endedAt":"2026-10-24T10:40:31Z",
         "device":{"model":"iPhone18,1","os":"iOS","osVersion":"26.1","lidar":true},"tier":1,
         "rooms":[{"id":"r1","name":"Living room","dir":"rooms/r1","startedAt":"2026-10-24T10:12:05Z"}],
         "counts":{"photos":42,"keyframes":310,"poses":90000,"tapeChecks":3,"cards":1,"depthSkipped":{"motion":800,"busy":2,"noDepth":0,"writeFailed":0}},
         "somethingNewer":true}
        """
        let manifest = try CaptureDates.decoder().decode(Manifest.self, from: Data(json.utf8))
        #expect(manifest.status == .complete)
        #expect(manifest.rooms.first?.dir == "rooms/r1")
        #expect(manifest.counts.depthSkipped.motion == 800)
    }

    @Test("writes the field names and date style the format asks for")
    func writesTheDocumentedNames() throws {
        var manifest = Manifest(id: "20261024T101200Z-7KQ2", createdAt: Date(timeIntervalSince1970: 1_792_836_720), tier: 1)
        manifest.device = .init(model: "iPhone18,1", os: "iOS", osVersion: "26.1", lidar: true)
        let text = String(decoding: try CaptureDates.encoder().encode(manifest), as: UTF8.self)
        #expect(text.contains(#""format":"fullscale-capture\/1""#) || text.contains(#""format":"fullscale-capture/1""#))
        #expect(text.contains(#""createdAt":"2026-10-24T"#))
        #expect(text.contains(#""depthSkipped""#))
        #expect(text.contains(#""status":"recording""#))
    }

    @Test("writes poses as 16 plain numbers and tape-check kinds in snake case")
    func writesRecords() throws {
        let check = TapeCheckRecord(id: "c1", room: "r1", kind: .doorWidth, appM: 0.8, tapeM: 0.81, entered: "81 cm", unit: "m", heldOut: false, obstructed: false, t: 12)
        let text = String(decoding: try CaptureDates.encoder().encode(check), as: UTF8.self)
        #expect(text.contains(#""kind":"door_width""#))
        let pose = try CaptureDates.encoder().encode(PoseRecord(t: 1, pose: .identity, tracking: .normal))
        #expect(String(decoding: pose, as: UTF8.self).contains(#""pose":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]"#))
    }

    @Test("writes a room's record and events with the documented names")
    func writesRoomsAndEvents() throws {
        var room = RoomRecord(id: "r1", name: "Kitchen", startedAt: Date(timeIntervalSince1970: 1_792_836_720))
        room.whiteBalance = .init(gains: [2.1, 1, 1.7], temperatureK: 4200, tint: 3, locked: true)
        room.counts.stills = 4
        let text = String(decoding: try CaptureDates.encoder().encode(room), as: UTF8.self)
        #expect(text.contains(#""whiteBalance":{"#))
        #expect(text.contains(#""temperatureK":4200"#))
        #expect(text.contains(#""stills":4"#))
        let event = String(decoding: try CaptureDates.encoder().encode(EventRecord(t: 3, kind: .whiteBalanceLocked, room: "r1")), as: UTF8.self)
        #expect(event.contains(#""kind":"white_balance_locked""#))
    }

    @Test("names captures by UTC time whatever the phone's settings")
    func namesCaptures() {
        var random = SystemRandomNumberGenerator()
        let id = CaptureNaming.captureID(at: Date(timeIntervalSince1970: 1_792_836_720), random: &random)
        #expect(id.hasPrefix("20261024T101200Z-"))
        #expect(id.count == "20261024T101200Z-7KQ2".count)
    }

    @Test("keeps paths inside the capture", arguments: [("photos/p1.jpg", true), ("../x", false), ("/etc/passwd", false), ("a/./b", false), (".hidden", false), ("a//b", false), ("", false)])
    func safePaths(path: String, safe: Bool) {
        #expect(CaptureNaming.isSafe(path) == safe)
    }
}

@Suite("Records that can't be written")
struct UsableRecordTests {
    func photo(pose: [Double] = Array(repeating: 0, count: 16), blur: Double = 1, fx: Double = 1400) -> PhotoRecord {
        PhotoRecord(
            id: "s1", file: "photos/s1.jpg", room: "r1", kind: .still, t: 10, width: 4032, height: 3024,
            pose: Pose(pose), intrinsics: Intrinsics(fx: fx, fy: fx, cx: 2016, cy: 1512), tracking: .normal, blurPx: blur,
            camera: .init(exposureS: 0.01, iso: 800, evOffset: 0, whiteBalanceGains: [2, 1, 1.6], whiteBalanceLocked: true, exposureLocked: false)
        )
    }

    @Test("a photo with a number JSON can't hold is not usable")
    func notFinite() {
        #expect(photo().isUsable)
        var pose = Array(repeating: 0.0, count: 16)
        pose[12] = .nan
        #expect(!photo(pose: pose).isUsable)
        #expect(!photo(blur: .infinity).isUsable)
        #expect(!photo(fx: 0).isUsable)
    }
}
