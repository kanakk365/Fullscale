// Whether the AR tracking can be trusted right now. Capture stops at once when tracking
// degrades, and starts again only after it has been good for a while, so a flickering state
// doesn't let bad frames through. A frame older than half a second means the session has
// stalled. A big jump in a short time means the world has shifted and is logged.
import Foundation

public struct TrackingGate: Sendable {
    public static let resumeAfterS = 1.5
    public static let staleFrameS = 0.5
    public static let jumpM = 0.5
    public static let jumpWithinS = 0.2

    public enum Event: Sendable, Equatable {
        case lost
        case resumed
        case jumped(metres: Double)
    }

    public private(set) var open = false
    private var goodSince: Double?
    private var last: (pose: Pose, t: Double)?

    public init() {}

    /// Feed each frame; returns what happened, if anything worth logging.
    public mutating func frame(tracking: Tracking, pose: Pose, t: Double, frameAgeS: Double) -> [Event] {
        var events: [Event] = []
        if let last, t - last.t < Self.jumpWithinS {
            let moved = Pose.distance(last.pose, pose)
            if moved > Self.jumpM { events.append(.jumped(metres: moved)) }
        }
        last = (pose, t)
        let good = tracking == .normal && frameAgeS <= Self.staleFrameS
        if !good {
            goodSince = nil
            if open {
                open = false
                events.append(.lost)
            }
            return events
        }
        let since = goodSince ?? t
        goodSince = since
        if !open && t - since >= Self.resumeAfterS {
            open = true
            events.append(.resumed)
        }
        return events
    }
}
