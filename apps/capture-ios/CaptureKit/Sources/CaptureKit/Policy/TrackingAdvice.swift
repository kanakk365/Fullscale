// What to tell the person when tracking is not good, in words that say what to do. Photos and
// depth are only kept while tracking is good, so these messages are how the person keeps
// the capture going.
import Foundation

/// Why tracking is limited, in the capture's own terms.
public enum TrackingReason: String, Codable, Sendable {
    case initializing
    case relocalizing
    case excessiveMotion = "excessive_motion"
    case insufficientFeatures = "insufficient_features"
    case other
}

/// What the room scanner asks of the person while it scans.
public enum ScannerInstruction: String, Sendable {
    case normal
    case moveCloseToWall = "move_close_to_wall"
    case moveAwayFromWall = "move_away_from_wall"
    case slowDown = "slow_down"
    case turnOnLight = "turn_on_light"
    case lowTexture = "low_texture"
}

public enum TrackingAdvice {
    /// The message to show, or nil when all is well. `gateOpen` is whether the capture is
    /// keeping frames (tracking has been good for a moment). Tracking comes first: without
    /// it nothing is kept, whatever the scanner would like.
    public static func message(tracking: Tracking, reason: TrackingReason?, gateOpen: Bool, instruction: ScannerInstruction? = nil) -> String? {
        switch tracking {
        case .normal:
            if !gateOpen { return "Hold steady for a moment…" }
            return instruction.flatMap(message(for:))
        case .notAvailable:
            return "Tracking stopped. Point the phone at the room and hold it still."
        case .limited:
            switch reason {
            case .initializing: return "Getting ready: move the phone slowly from side to side."
            case .relocalizing: return "Go back to where tracking was lost and point at the same things."
            case .excessiveMotion: return "Too fast: move the phone more slowly."
            case .insufficientFeatures: return "Not enough detail here: point at furniture or edges, or turn on a light."
            case .other, nil: return "Tracking is limited: move slowly."
            }
        }
    }
}

extension TrackingAdvice {
    static func message(for instruction: ScannerInstruction) -> String? {
        switch instruction {
        case .normal: nil
        case .moveCloseToWall: "Move closer to the wall."
        case .moveAwayFromWall: "Step back from the wall."
        case .slowDown: "Slow down."
        case .turnOnLight: "Too dark: turn on a light."
        case .lowTexture: "Plain surfaces here: keep some furniture or edges in view."
        }
    }
}
