// How hard the capture may push the phone. A hot phone throttles and drops frames, and a
// memory warning ignored gets the app killed mid-room, so capture eases off when either
// happens (or when a room already has many photos), and won't start without room to store.
import Foundation

public enum ThermalState: Int, Sendable, Comparable {
    case nominal, fair, serious, critical
    public static func < (a: ThermalState, b: ThermalState) -> Bool { a.rawValue < b.rawValue }
}

public struct CaptureBudget: Sendable, Equatable {
    public var depthPerSecond: Double
    public var photoIntervalS: Double
    public var stills: Bool

    public static let normal = CaptureBudget(depthPerSecond: 5, photoIntervalS: 0.4, stills: true)
    public static let strained = CaptureBudget(depthPerSecond: 2, photoIntervalS: 1.2, stills: false)
    public static let critical = CaptureBudget(depthPerSecond: 1, photoIntervalS: 1.2, stills: false)

    public static let memoryWarningLastsS = 60.0
    public static let manyPhotos = 150
    public static let freeBytesToStart: Int64 = 500_000_000
    public static let freeBytesToContinue: Int64 = 200_000_000

    public static func current(thermal: ThermalState, secondsSinceMemoryWarning: Double?, photosInRoom: Int) -> CaptureBudget {
        if thermal >= .critical { return .critical }
        let recentWarning = secondsSinceMemoryWarning.map { $0 < memoryWarningLastsS } ?? false
        if thermal >= .serious || recentWarning || photosInRoom >= manyPhotos { return .strained }
        return .normal
    }

    public static func canStart(freeBytes: Int64) -> Bool { freeBytes >= freeBytesToStart }
    public static func mustPause(freeBytes: Int64) -> Bool { freeBytes < freeBytesToContinue }
}

/// When a room has enough to stop.
public struct RoomVerdict: Sendable, Equatable {
    public var ready: Bool
    /// More scanning has stopped adding much, so stopping loses little.
    public var canStop: Bool

    public static let minWalls = 3
    public static let minPhotos = 8
    public static let minCoverage = 0.85
    public static let plateauAfterS = 120.0
    public static let plateauWindowS = 45.0
    public static let plateauGain = 0.02

    /// `coverage` is the share of the room seen well (0…1) when known; `coverageWindowAgo`
    /// is what it was `plateauWindowS` ago.
    public static func judge(walls: Int, photos: Int, coverage: Double?, coverageWindowAgo: Double?, elapsedS: Double) -> RoomVerdict {
        let covered = coverage.map { $0 >= minCoverage } ?? true
        let ready = walls >= minWalls && photos >= minPhotos && covered
        var plateau = false
        if elapsedS >= plateauAfterS, let now = coverage, let before = coverageWindowAgo {
            plateau = now - before < plateauGain
        }
        return RoomVerdict(ready: ready, canStop: ready || plateau)
    }
}
