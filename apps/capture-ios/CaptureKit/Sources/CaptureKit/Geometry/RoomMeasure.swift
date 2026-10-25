// A scanned room's main numbers, for the app's screens: floor area, the room's two sides along
// its walls, and ceiling height. Worked out from the scanner's walls and floor in plan (x, z),
// so they can be tested without the scanner.
import Foundation
import simd

/// A wall seen from above: its two ends on the plan (x, z) and its height.
public struct WallSegment: Sendable, Equatable {
    public var start: SIMD2<Double>
    public var end: SIMD2<Double>
    public var heightM: Double

    public init(start: SIMD2<Double>, end: SIMD2<Double>, heightM: Double) {
        self.start = start
        self.end = end
        self.heightM = heightM
    }

    public var lengthM: Double { simd_length(end - start) }
}

public struct RoomSummary: Codable, Sendable, Equatable {
    public var floorAreaM2: Double?
    /// The room's sides along its main walls, longer first.
    public var lengthM: Double?
    public var widthM: Double?
    public var heightM: Double?
    public var walls: Int
    public var doors: Int
    public var windows: Int
    public var objects: Int
    public var photos: Int

    public init(floorAreaM2: Double?, lengthM: Double?, widthM: Double?, heightM: Double?, walls: Int, doors: Int, windows: Int, objects: Int, photos: Int) {
        self.floorAreaM2 = floorAreaM2
        self.lengthM = lengthM
        self.widthM = widthM
        self.heightM = heightM
        self.walls = walls
        self.doors = doors
        self.windows = windows
        self.objects = objects
        self.photos = photos
    }
}

public enum RoomMeasure {
    public static func summary(walls: [WallSegment], floor: [SIMD2<Double>], doors: Int, windows: Int, objects: Int, photos: Int) -> RoomSummary {
        let sides = sides(walls)
        let area = floor.count >= 3 ? abs(shoelace(floor)) : sides.map { $0.0 * $0.1 }
        return RoomSummary(
            floorAreaM2: area,
            lengthM: sides?.0,
            widthM: sides?.1,
            heightM: walls.map(\.heightM).max(),
            walls: walls.count, doors: doors, windows: windows, objects: objects, photos: photos
        )
    }

    /// The direction most walls run along, folded into a quarter turn (walls usually meet at
    /// right angles), weighting long walls more. In radians, from +x towards +z.
    public static func mainDirection(_ walls: [WallSegment]) -> Double {
        var s = 0.0
        var c = 0.0
        for w in walls {
            let d = w.end - w.start
            let a = atan2(d.y, d.x)
            s += w.lengthM * sin(4 * a)
            c += w.lengthM * cos(4 * a)
        }
        return atan2(s, c) / 4
    }

    /// The room's extent along its main walls and across them, longer first.
    static func sides(_ walls: [WallSegment]) -> (Double, Double)? {
        guard walls.count >= 2 else { return nil }
        let a = mainDirection(walls)
        let along = SIMD2(cos(a), sin(a))
        let across = SIMD2(-sin(a), cos(a))
        let ends = walls.flatMap { [$0.start, $0.end] }
        let u = ends.map { simd_dot($0, along) }
        let v = ends.map { simd_dot($0, across) }
        let one = u.max()! - u.min()!
        let two = v.max()! - v.min()!
        return (max(one, two), min(one, two))
    }

    static func shoelace(_ p: [SIMD2<Double>]) -> Double {
        var sum = 0.0
        for i in p.indices {
            let a = p[i]
            let b = p[(i + 1) % p.count]
            sum += a.x * b.y - b.x * a.y
        }
        return sum / 2
    }
}
