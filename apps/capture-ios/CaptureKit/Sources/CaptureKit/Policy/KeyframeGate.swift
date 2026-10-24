// Which camera frames to keep as depth keyframes. Every frame would fill the phone in
// minutes, and frames from the same spot add nothing, so a frame is kept only after the
// camera has moved or turned enough, no faster than the budget allows, and only while
// tracking is good and the writer is keeping up.
import Foundation

public struct KeyframeGate: Sendable {
    public enum Outcome: String, Sendable, Equatable {
        case keep
        /// The camera hasn't moved or turned enough since the last keyframe.
        case motion
        /// Too soon after the last keyframe for the current budget.
        case interval
        /// Too many frames are still waiting to be written.
        case busy
        /// Tracking isn't good enough to trust the pose.
        case tracking
    }

    public static let minMoveM = 0.04
    public static let minTurnRad = 0.06
    public static let maxWaiting = 3

    /// Seconds between keyframes; the capture budget raises it when the phone is strained.
    public var minIntervalS: Double
    private var last: (pose: Pose, t: Double)?

    public init(minIntervalS: Double = 0.2) {
        self.minIntervalS = minIntervalS
    }

    public mutating func consider(pose: Pose, t: Double, tracking: Tracking, waitingWrites: Int) -> Outcome {
        guard tracking == .normal else { return .tracking }
        guard waitingWrites <= Self.maxWaiting else { return .busy }
        if let last {
            if t - last.t < minIntervalS { return .interval }
            if Pose.distance(last.pose, pose) <= Self.minMoveM && Pose.turn(last.pose, pose) <= Self.minTurnRad { return .motion }
        }
        last = (pose, t)
        return .keep
    }
}
