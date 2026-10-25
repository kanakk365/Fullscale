// The scanner's room (Apple's CapturedRoom) in the plain shapes CaptureKit measures: walls as
// lines on the plan, the floor's outline, and the room's main numbers.
import CaptureKit
import Foundation
import RoomPlan
import simd

enum RoomShape {
    static func walls(_ room: CapturedRoom) -> [WallSegment] {
        room.walls.map { wall in
            let t = wall.transform
            let centre = SIMD3<Double>(Double(t.columns.3.x), Double(t.columns.3.y), Double(t.columns.3.z))
            let along = SIMD3<Double>(Double(t.columns.0.x), Double(t.columns.0.y), Double(t.columns.0.z))
            let half = Double(wall.dimensions.x) / 2
            let a = centre - along * half
            let b = centre + along * half
            return WallSegment(start: SIMD2(a.x, a.z), end: SIMD2(b.x, b.z), heightM: Double(wall.dimensions.y))
        }
    }

    /// The floor's outline on the plan, when the scanner found the floor.
    static func floor(_ room: CapturedRoom) -> [SIMD2<Double>] {
        guard let floor = room.floors.first else { return [] }
        return floor.polygonCorners.map { corner in
            let p = floor.transform * SIMD4<Float>(corner, 1)
            return SIMD2(Double(p.x), Double(p.z))
        }
    }

    /// A room's layout read back from its capture (written with NaN and infinity as strings).
    static func read(_ capture: URL, room: String) -> CapturedRoom? {
        guard let data = try? Data(contentsOf: capture.appendingPathComponent("rooms/\(room)/roomplan.json")) else { return nil }
        let decoder = JSONDecoder()
        decoder.nonConformingFloatDecodingStrategy = .convertFromString(positiveInfinity: "inf", negativeInfinity: "-inf", nan: "nan")
        return try? decoder.decode(CapturedRoom.self, from: data)
    }

    static func summary(_ room: CapturedRoom?, photos: Int) -> RoomSummary {
        guard let room else {
            return RoomSummary(floorAreaM2: nil, lengthM: nil, widthM: nil, heightM: nil, walls: 0, doors: 0, windows: 0, objects: 0, photos: photos)
        }
        return RoomMeasure.summary(walls: walls(room), floor: floor(room), doors: room.doors.count, windows: room.windows.count, objects: room.objects.count, photos: photos)
    }
}
