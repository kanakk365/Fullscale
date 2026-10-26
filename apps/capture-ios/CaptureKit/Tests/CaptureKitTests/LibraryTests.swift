import Foundation
import Testing
@testable import CaptureKit

@Suite("The phone's library of spaces and rooms")
struct LibraryTests {
    let now = Date(timeIntervalSince1970: 1_792_900_000)

    func scan(_ capture: String, area: Double? = nil, adds: Bool = false) -> Library.Scan {
        let summary = area.map { RoomSummary(floorAreaM2: $0, lengthM: nil, widthM: nil, heightM: nil, walls: 4, doors: 1, windows: 1, objects: 0, photos: 30) }
        return Library.Scan(capture: capture, room: "r1", scannedAt: now, addsToEarlier: adds, summary: summary)
    }

    @Test("organises rooms in spaces and keeps every scan of a room")
    func organises() throws {
        var library = Library()
        let home = library.addSpace(name: "  ", kind: .home, now: now, id: "home")
        let bedroom = try library.addRoom(to: home, name: "Bedroom", now: now, id: "bed")
        try library.addRoom(to: home, name: "Kitchen", now: now, id: "kitchen")
        try library.record(scan("c1", area: 11.5), room: bedroom, space: home)
        try library.record(scan("c2", area: 12.0, adds: true), room: bedroom, space: home)
        let space = try #require(library.space(home))
        #expect(space.name == "Home")
        #expect(space.rooms.map(\.name) == ["Bedroom", "Kitchen"])
        #expect(space.rooms[0].scans.map(\.capture) == ["c1", "c2"])
        // The latest scan of each room counts; rooms not scanned yet add nothing.
        #expect(space.floorAreaM2 == 12.0)
    }

    @Test("gives a second room of the same name a number")
    func uniqueNames() throws {
        var library = Library()
        let home = library.addSpace(name: "Flat", kind: .home, now: now)
        try library.addRoom(to: home, name: "Bedroom", now: now)
        try library.addRoom(to: home, name: "bedroom", now: now)
        try library.addRoom(to: home, name: "", now: now)
        #expect(library.space(home)?.rooms.map(\.name) == ["Bedroom", "bedroom 2", "Room 3"])
    }

    @Test("removing a room hands back only the captures nothing else uses")
    func removing() throws {
        var library = Library()
        let home = library.addSpace(name: "Home", kind: .home, now: now)
        let a = try library.addRoom(to: home, name: "A", now: now)
        let b = try library.addRoom(to: home, name: "B", now: now)
        // One capture scanned both rooms.
        try library.record(scan("shared"), room: a, space: home)
        try library.record(scan("shared"), room: b, space: home)
        try library.record(scan("only-a"), room: a, space: home)
        #expect(try library.removeRoom(a, in: home) == ["only-a"])
        #expect(try library.removeSpace(home) == ["shared"])
    }

    @Test("forgets scans whose capture was deleted")
    func forgets() throws {
        var library = Library()
        let home = library.addSpace(name: "Home", kind: .home, now: now)
        let room = try library.addRoom(to: home, name: "A", now: now)
        try library.record(scan("kept"), room: room, space: home)
        try library.record(scan("gone"), room: room, space: home)
        library.keepOnly(captures: ["kept"])
        #expect(library.space(home)?.rooms[0].scans.map(\.capture) == ["kept"])
    }

    @Test("refuses rooms in a space that isn't there")
    func refuses() {
        var library = Library()
        #expect(throws: LibraryError.noSuchSpace("x")) { try library.addRoom(to: "x", name: "A", now: now) }
    }

    @Test("survives being saved and read back")
    func roundTrip() throws {
        var library = Library()
        let home = library.addSpace(name: "Home", kind: .office, now: now)
        let room = try library.addRoom(to: home, name: "A", now: now)
        try library.record(scan("c1", area: 9), room: room, space: home)
        let data = try CaptureDates.encoder().encode(library)
        #expect(try CaptureDates.decoder().decode(Library.self, from: data) == library)
    }
}

@Suite("Room numbers and scan progress")
struct RoomProgressTests {
    /// A 4 × 3 m room turned 30°, as an AR world starts wherever the phone is.
    func room(turn: Double = .pi / 6, height: Double = 2.6) -> [WallSegment] {
        let corners = [SIMD2(0.0, 0.0), SIMD2(4.0, 0.0), SIMD2(4.0, 3.0), SIMD2(0.0, 3.0)].map { p in
            SIMD2(p.x * cos(turn) - p.y * sin(turn), p.x * sin(turn) + p.y * cos(turn))
        }
        return (0..<4).map { WallSegment(start: corners[$0], end: corners[($0 + 1) % 4], heightM: height) }
    }

    @Test("measures a turned room along its own walls")
    func measures() {
        let walls = room()
        let floor = walls.map(\.start)
        let summary = RoomMeasure.summary(walls: walls, floor: floor, doors: 1, windows: 2, objects: 3, photos: 40)
        #expect(abs(summary.floorAreaM2! - 12) < 1e-9)
        #expect(abs(summary.lengthM! - 4) < 1e-9)
        #expect(abs(summary.widthM! - 3) < 1e-9)
        #expect(summary.heightM == 2.6)
        // Without a floor outline, the area comes from the walls' extent.
        #expect(abs(RoomMeasure.summary(walls: walls, floor: [], doors: 0, windows: 0, objects: 0, photos: 0).floorAreaM2! - 12) < 1e-9)
    }

    @Test("counts wall ends that don't meet")
    func openEnds() {
        let walls = room()
        #expect(ScanProgress.openEnds(walls) == 0)
        #expect(ScanProgress.openEnds(Array(walls.prefix(3))) == 2)
        #expect(ScanProgress.openEnds([walls[0]]) == 2)
    }

    @Test("says what to do next, in order, until the room is complete")
    func guides() {
        var seen = ScanProgress.Seen(walls: [], floorFound: false, ceilingSeen: nil, photos: 0, hasScanner: true)
        #expect(ScanProgress.judge(seen).next == .walkAlongWalls)
        #expect(ScanProgress.judge(seen).fraction == 0)
        seen.walls = room()
        #expect(ScanProgress.judge(seen).next == .lookAtFloor)
        seen.floorFound = true
        seen.ceilingSeen = 0.3
        let half = ScanProgress.judge(seen)
        #expect(half.next == .sweepCeiling)
        #expect(half.items.first { $0.topic == .ceiling }?.state == .partly)
        seen.ceilingSeen = 0.7
        seen.photos = 10
        let enough = ScanProgress.judge(seen)
        #expect(enough.complete)
        #expect(enough.next == .morePhotos)
        seen.photos = 40
        let details = ScanProgress.judge(seen)
        #expect(details.complete)
        #expect(details.next == .detailPhotos)
        #expect(details.items.first { $0.topic == .details }?.state == .todo)
        seen.details = 3
        let done = ScanProgress.judge(seen)
        #expect(done.next == .done)
        #expect(done.fraction == 1)
        #expect(done.items.allSatisfy { $0.state == .done })
    }

    @Test("lets a room that opens onto another finish")
    func openPlan() {
        let seen = ScanProgress.Seen(walls: Array(room().prefix(3)), floorFound: true, ceilingSeen: 0.8, photos: 40, hasScanner: true, details: 3)
        let progress = ScanProgress.judge(seen)
        #expect(progress.complete)
        #expect(progress.next == .nearlyDone)
    }

    @Test("counts only photos on a phone without a scanner")
    func photosOnly() {
        let progress = ScanProgress.judge(.init(walls: [], floorFound: false, ceilingSeen: nil, photos: 15, hasScanner: false))
        #expect(progress.items.map(\.topic) == [.photos, .details])
        #expect(progress.fraction == 0.5)
        #expect(!progress.complete)
    }

    @Test("shows lengths and areas in metres or feet and inches", arguments: [
        (4.71, LengthSystem.metric, "4.71 m"),
        (4.71, LengthSystem.imperial, "15′ 5″"),
        (2.4384, LengthSystem.imperial, "8′ 0″"),
    ])
    func formats(metres: Double, system: LengthSystem, text: String) {
        #expect(LengthFormat.length(metres, system) == text)
    }

    @Test("shows areas and differences")
    func formatsAreas() {
        #expect(LengthFormat.area(11.55, .metric) == "11.6 m²")
        #expect(LengthFormat.area(11.55, .imperial) == "124 ft²")
        #expect(LengthFormat.difference(0.012, .metric) == "+1.2 cm")
        #expect(LengthFormat.difference(-0.0127, .imperial) == "−0.5″")
    }
}
