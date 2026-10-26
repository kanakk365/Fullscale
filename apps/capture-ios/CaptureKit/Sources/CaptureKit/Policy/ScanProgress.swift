// How far a room's scan has got, for the scan screen: a short checklist (walls, floor, ceiling,
// photos, detail photos), one number for a progress ring, whether the room looks complete, and
// the one thing to do next. Worked out from what the scanner and the camera have found so far.
// Detail photos (close-ups of prints, pictures and screens) don't hold up finishing, but the
// computer needs them to copy those surfaces onto the model, so they are asked for last.
import Foundation
import simd

public struct ScanProgress: Sendable, Equatable {
    public enum Topic: String, Sendable, CaseIterable {
        case walls, floor, ceiling, photos, details
    }

    public enum State: Sendable, Equatable {
        case todo, partly, done
    }

    public struct Item: Sendable, Equatable, Identifiable {
        public var topic: Topic
        public var state: State
        public var id: Topic { topic }
    }

    /// What to do next, most important first.
    public enum Next: Sendable, Equatable {
        case walkAlongWalls, lookAtFloor, sweepCeiling, morePhotos, detailPhotos
        /// Complete, but some wall ends don't meet: fine where the room opens onto another.
        case nearlyDone
        case done

        public var message: String {
            switch self {
            case .walkAlongWalls: "Walk slowly along the walls until they join up on the model."
            case .lookAtFloor: "Point the phone down at the floor for a moment."
            case .sweepCeiling: "Tilt up and sweep across the ceiling."
            case .morePhotos: "Get closer to furniture and corners for sharper photos."
            case .detailPhotos: "Tap Detail for close-ups of patterns, pictures and screens: hold still about half a metre away, facing them."
            case .nearlyDone: "Looks complete. A wall end is open, which is fine if the room opens onto another."
            case .done: "Looks complete. Tap Finish when you're happy."
            }
        }
    }

    /// What the scan has found so far.
    public struct Seen: Sendable, Equatable {
        public var walls: [WallSegment]
        public var floorFound: Bool
        /// How much of the ceiling the depth sensor has seen, as a share of the floor's area.
        public var ceilingSeen: Double?
        public var photos: Int
        /// False on phones without LiDAR: there are no walls, floor or ceiling to find.
        public var hasScanner: Bool
        /// Close-ups taken with the Detail button.
        public var details: Int

        public init(walls: [WallSegment], floorFound: Bool, ceilingSeen: Double?, photos: Int, hasScanner: Bool, details: Int = 0) {
            self.walls = walls
            self.floorFound = floorFound
            self.ceilingSeen = ceilingSeen
            self.photos = photos
            self.hasScanner = hasScanner
            self.details = details
        }
    }

    public static let enoughPhotos = 30
    public static let enoughDetails = 3
    public static let ceilingEnough = 0.6
    /// Wall ends closer than this count as meeting at a corner.
    public static let cornerM = 0.3

    public var items: [Item]
    /// 0 to 1, for a progress ring.
    public var fraction: Double
    public var complete: Bool
    public var next: Next

    public static func judge(_ seen: Seen) -> ScanProgress {
        let photoScore = min(Double(seen.photos) / Double(enoughPhotos), 1)
        let photos = Item(topic: .photos, state: seen.photos >= enoughPhotos ? .done : seen.photos >= RoomVerdict.minPhotos ? .partly : .todo)
        let detailsDone = seen.details >= enoughDetails
        let details = Item(topic: .details, state: detailsDone ? .done : seen.details > 0 ? .partly : .todo)
        guard seen.hasScanner else {
            let complete = seen.photos >= enoughPhotos
            return ScanProgress(items: [photos, details], fraction: photoScore, complete: complete, next: !complete ? .morePhotos : detailsDone ? .done : .detailPhotos)
        }

        let open = openEnds(seen.walls)
        let wallsEnough = seen.walls.count >= RoomVerdict.minWalls && open <= 2
        let wallScore: Double = seen.walls.isEmpty ? 0 : open == 0 && seen.walls.count >= RoomVerdict.minWalls ? 1 : wallsEnough ? 0.85 : min(Double(seen.walls.count) / 5, 0.7)
        let ceiling = seen.ceilingSeen ?? 0
        let ceilingScore = min(ceiling / ceilingEnough, 1)

        let items = [
            Item(topic: .walls, state: wallScore == 1 ? .done : seen.walls.isEmpty ? .todo : .partly),
            Item(topic: .floor, state: seen.floorFound ? .done : .todo),
            Item(topic: .ceiling, state: ceilingScore >= 1 ? .done : ceiling > 0.05 ? .partly : .todo),
            photos,
            details,
        ]
        let fraction = 0.4 * wallScore + 0.15 * (seen.floorFound ? 1 : 0) + 0.2 * ceilingScore + 0.25 * photoScore
        let complete = wallsEnough && seen.floorFound && ceilingScore >= 1 && seen.photos >= RoomVerdict.minPhotos

        let next: Next
        if !wallsEnough {
            next = .walkAlongWalls
        } else if !seen.floorFound {
            next = .lookAtFloor
        } else if ceilingScore < 1 {
            next = .sweepCeiling
        } else if seen.photos < enoughPhotos {
            next = .morePhotos
        } else if !detailsDone {
            next = .detailPhotos
        } else {
            next = open == 0 ? .done : .nearlyDone
        }
        return ScanProgress(items: items, fraction: fraction, complete: complete, next: next)
    }

    /// How many wall ends don't meet another wall's end.
    public static func openEnds(_ walls: [WallSegment]) -> Int {
        var open = 0
        for (i, wall) in walls.enumerated() {
            for end in [wall.start, wall.end] {
                let meets = walls.enumerated().contains { j, other in
                    j != i && (simd_distance(end, other.start) <= cornerM || simd_distance(end, other.end) <= cornerM)
                }
                if !meets { open += 1 }
            }
        }
        return open
    }
}
