// Full-resolution stills: the camera's full 12 MP picture, taken alongside a kept photo for
// colour and detail. They are slow and heat the phone, so they are rationed, and a still is
// kept only if it shows the same view as the photo it was taken for and is about as sharp.
import Foundation

public struct StillPolicy: Sendable {
    public static let minIntervalS = 3.0
    /// A still answer older than this is dropped (the view has moved on).
    public static let answerTimeoutS = 3.0
    public static let sameViewM = 0.20
    public static let sameViewRad = 12.0 * .pi / 180
    /// Blur is compared at this image width, so stills and video frames are comparable.
    public static let compareWidth = 1920.0

    public init() {}

    public func mayRequest(now: Double, lastStill: Double?, thermalNominal: Bool, enabled: Bool) -> Bool {
        guard enabled, thermalNominal else { return false }
        guard let lastStill else { return true }
        return now - lastStill >= Self.minIntervalS
    }

    /// Keep a still taken for `held`? `stillBlurPx` is measured at the still's own width.
    public func accept(stillPose: Pose, stillBlurPx: Double, stillWidth: Double, held: PhotoCandidate) -> Bool {
        guard Pose.distance(stillPose, held.pose) <= Self.sameViewM, Pose.turn(stillPose, held.pose) <= Self.sameViewRad else { return false }
        let comparable = stillBlurPx * Self.compareWidth / stillWidth
        return comparable <= max(held.blurPx, 1.5) * 1.2
    }
}

/// The still asked for, and which photo it was asked for. One at a time: the camera takes
/// one still at once, and a still that never comes back must not stop the next.
public struct StillRequests: Sendable {
    public struct Waiting: Sendable, Equatable {
        public var forID: String
        public var askedAt: Double
    }

    public private(set) var waiting: Waiting?
    private var lastAsked: Double?
    private let policy = StillPolicy()

    public init() {}

    /// Ask for a still for the photo `id`? When the answer is yes, the request is noted.
    public mutating func ask(for id: String, now: Double, thermalNominal: Bool, enabled: Bool) -> Bool {
        if let waiting, now - waiting.askedAt > StillPolicy.answerTimeoutS { self.waiting = nil }
        guard waiting == nil, policy.mayRequest(now: now, lastStill: lastAsked, thermalNominal: thermalNominal, enabled: enabled) else { return false }
        waiting = Waiting(forID: id, askedAt: now)
        lastAsked = now
        return true
    }

    /// The still came back (or failed) at `now`: the photo it was for, or nil when it came
    /// too late to show the same view.
    public mutating func arrived(now: Double) -> String? {
        defer { waiting = nil }
        guard let waiting, now - waiting.askedAt <= StillPolicy.answerTimeoutS else { return nil }
        return waiting.forID
    }
}
