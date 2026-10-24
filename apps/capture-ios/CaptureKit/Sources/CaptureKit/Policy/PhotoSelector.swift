// Choosing photos while the person walks around: hold the sharpest frame of each view.
//
// A candidate frame is held, and replaced only by a clearly sharper one of the same view.
// It is kept (committed) as soon as it is sharp enough, when the camera has moved on to a
// new view, or after it has been held a while. Views too close to a recent photo are
// skipped, and frames blurrier than a hard limit are never kept. Blur is the predicted blur
// from the camera's motion, which costs nothing to work out.
import Foundation

public struct PhotoCandidate: Sendable, Equatable {
    public var id: String
    public var pose: Pose
    public var t: Double
    public var blurPx: Double

    public init(id: String, pose: Pose, t: Double, blurPx: Double) {
        self.id = id
        self.pose = pose
        self.t = t
        self.blurPx = blurPx
    }
}

public struct PhotoSelector: Sendable {
    public struct Limits: Sendable {
        /// Kept at once when at most this blurry.
        public var sharpPx = 1.5
        /// Never kept when blurrier than this.
        public var maxPx = 6.0
        /// A new frame replaces the held one only if this much sharper.
        public var replaceFactor = 0.8
        /// The view has moved on after this much movement or turn.
        public var moveOnM = 0.30
        public var moveOnRad = 15.0 * .pi / 180
        /// Kept anyway after being held this long.
        public var holdS = 1.2
        /// A photo must differ from each recent one by this much movement or turn.
        public var newViewM = 0.12
        public var newViewRad = 10.0 * .pi / 180
        public var recentCount = 8

        public init() {}

        /// For photo-real captures, which need sharper photos.
        public static var photoreal: Limits {
            var l = Limits()
            l.maxPx = 3
            return l
        }
    }

    public var limits: Limits
    private var held: (candidate: PhotoCandidate, since: Double)?

    /// The frame being held, so the app copies a frame's image only when it becomes the
    /// held one rather than for every frame.
    public var heldID: String? { held?.candidate.id }
    private var recent: [Pose] = []

    public init(limits: Limits = Limits()) {
        self.limits = limits
    }

    /// Offer the latest frame; returns the photos to keep now (zero or one, rarely two).
    public mutating func offer(_ frame: PhotoCandidate) -> [PhotoCandidate] {
        var kept: [PhotoCandidate] = []
        if let h = held, movedOn(from: h.candidate.pose, to: frame.pose) || frame.t - h.since >= limits.holdS {
            kept.append(commit(h.candidate))
        }
        guard frame.blurPx <= limits.maxPx, isNewView(frame.pose) else { return kept }
        if let h = held {
            if frame.blurPx < h.candidate.blurPx * limits.replaceFactor { held = (frame, h.since) }
        } else {
            held = (frame, frame.t)
        }
        if let h = held, h.candidate.blurPx <= limits.sharpPx {
            kept.append(commit(h.candidate))
        }
        return kept
    }

    /// Keep whatever is held, e.g. when the room ends.
    public mutating func flush() -> [PhotoCandidate] {
        guard let h = held else { return [] }
        return [commit(h.candidate)]
    }

    private mutating func commit(_ candidate: PhotoCandidate) -> PhotoCandidate {
        held = nil
        recent.append(candidate.pose)
        if recent.count > limits.recentCount { recent.removeFirst() }
        return candidate
    }

    private func movedOn(from a: Pose, to b: Pose) -> Bool {
        Pose.distance(a, b) > limits.moveOnM || Pose.turn(a, b) > limits.moveOnRad
    }

    private func isNewView(_ pose: Pose) -> Bool {
        recent.allSatisfy { Pose.distance($0, pose) > limits.newViewM || Pose.turn($0, pose) > limits.newViewRad }
    }
}
