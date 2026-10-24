// The records a capture writes, one JSON object per line (docs/capture-format.md).
import Foundation

/// A camera's focal lengths and centre, in pixels of the image it belongs to. Named fields,
/// never a bare 3 × 3 matrix, so rows and columns can't be mixed up.
public struct Intrinsics: Codable, Sendable, Equatable {
    public var fx: Double
    public var fy: Double
    public var cx: Double
    public var cy: Double

    public init(fx: Double, fy: Double, cx: Double, cy: Double) {
        self.fx = fx
        self.fy = fy
        self.cx = cx
        self.cy = cy
    }

    /// The same camera for the image resized from one size to another.
    public func scaled(from: (width: Double, height: Double), to: (width: Double, height: Double)) -> Intrinsics {
        let sx = to.width / from.width
        let sy = to.height / from.height
        return Intrinsics(fx: fx * sx, fy: fy * sy, cx: cx * sx, cy: cy * sy)
    }
}

public enum Tracking: String, Codable, Sendable {
    case normal
    case limited
    case notAvailable
}

public struct PhotoRecord: Codable, Sendable, Equatable {
    public enum Kind: String, Codable, Sendable { case auto, manual, still, card, tape }

    public struct Camera: Codable, Sendable, Equatable {
        public var exposureS: Double
        public var iso: Double
        public var evOffset: Double
        public var whiteBalanceGains: [Double]
        public var whiteBalanceLocked: Bool
        public var exposureLocked: Bool

        public init(exposureS: Double, iso: Double, evOffset: Double, whiteBalanceGains: [Double], whiteBalanceLocked: Bool, exposureLocked: Bool) {
            self.exposureS = exposureS
            self.iso = iso
            self.evOffset = evOffset
            self.whiteBalanceGains = whiteBalanceGains
            self.whiteBalanceLocked = whiteBalanceLocked
            self.exposureLocked = exposureLocked
        }
    }

    public var id: String
    public var file: String
    public var room: String
    public var kind: Kind
    /// Seconds since the device booted.
    public var t: Double
    public var width: Int
    public var height: Int
    public var pose: Pose
    public var intrinsics: Intrinsics
    public var tracking: Tracking
    public var blurPx: Double
    public var camera: Camera
    public var keyframe: String?

    public init(id: String, file: String, room: String, kind: Kind, t: Double, width: Int, height: Int, pose: Pose, intrinsics: Intrinsics, tracking: Tracking, blurPx: Double, camera: Camera, keyframe: String? = nil) {
        self.id = id
        self.file = file
        self.room = room
        self.kind = kind
        self.t = t
        self.width = width
        self.height = height
        self.pose = pose
        self.intrinsics = intrinsics
        self.tracking = tracking
        self.blurPx = blurPx
        self.camera = camera
        self.keyframe = keyframe
    }
}

public struct KeyframeRecord: Codable, Sendable, Equatable {
    public struct Image: Codable, Sendable, Equatable {
        public var file: String
        public var width: Int
        public var height: Int
        public var intrinsics: Intrinsics
        public init(file: String, width: Int, height: Int, intrinsics: Intrinsics) {
            self.file = file
            self.width = width
            self.height = height
            self.intrinsics = intrinsics
        }
    }

    public struct Confidence: Codable, Sendable, Equatable {
        public var file: String
        public init(file: String) { self.file = file }
    }

    public var id: String
    public var t: Double
    public var room: String
    public var pose: Pose
    public var depth: Image
    public var confidence: Confidence
    public var rgb: Image

    public init(id: String, t: Double, room: String, pose: Pose, depth: Image, confidence: Confidence, rgb: Image) {
        self.id = id
        self.t = t
        self.room = room
        self.pose = pose
        self.depth = depth
        self.confidence = confidence
        self.rgb = rgb
    }
}

/// A length the person measured with a tape, to check the scan against.
public struct TapeCheckRecord: Codable, Sendable, Equatable {
    public enum Kind: String, Codable, Sendable, CaseIterable {
        case wallLength = "wall_length"
        case doorWidth = "door_width"
        case doorHeight = "door_height"
        case windowWidth = "window_width"
        case ceilingHeight = "ceiling_height"
        case diagonal
        case other
    }

    public var id: String
    public var room: String
    public var kind: Kind
    /// The scanner identifier of the element measured, when the person picked one.
    public var element: String?
    /// The two measured points in world metres, when picked on the mesh.
    public var a: [Double]?
    public var b: [Double]?
    /// What the scan says, metres.
    public var appM: Double?
    /// What the tape says, metres.
    public var tapeM: Double
    /// Exactly what the person typed.
    public var entered: String
    public var unit: String
    /// Kept back to test the result rather than to correct it.
    public var heldOut: Bool
    public var obstructed: Bool
    public var note: String?
    public var t: Double

    public init(id: String, room: String, kind: Kind, element: String? = nil, a: [Double]? = nil, b: [Double]? = nil, appM: Double?, tapeM: Double, entered: String, unit: String, heldOut: Bool, obstructed: Bool, note: String? = nil, t: Double) {
        self.id = id
        self.room = room
        self.kind = kind
        self.element = element
        self.a = a
        self.b = b
        self.appM = appM
        self.tapeM = tapeM
        self.entered = entered
        self.unit = unit
        self.heldOut = heldOut
        self.obstructed = obstructed
        self.note = note
        self.t = t
    }
}

public struct ColourCardRecord: Codable, Sendable, Equatable {
    public var id: String
    public var room: String
    /// Which card, e.g. "grey-18".
    public var card: String
    public var photo: String
    public var whiteBalanceGains: [Double]
    public var temperatureK: Double
    public var tint: Double
    public var iso: Double
    public var exposureS: Double
    public var evOffset: Double
    /// The card's corners in the photo's pixels, when tapped.
    public var corners: [[Double]]?

    public init(id: String, room: String, card: String, photo: String, whiteBalanceGains: [Double], temperatureK: Double, tint: Double, iso: Double, exposureS: Double, evOffset: Double, corners: [[Double]]? = nil) {
        self.id = id
        self.room = room
        self.card = card
        self.photo = photo
        self.whiteBalanceGains = whiteBalanceGains
        self.temperatureK = temperatureK
        self.tint = tint
        self.iso = iso
        self.exposureS = exposureS
        self.evOffset = evOffset
        self.corners = corners
    }
}

public struct PoseRecord: Codable, Sendable, Equatable {
    public var t: Double
    public var pose: Pose
    public var tracking: Tracking
    public init(t: Double, pose: Pose, tracking: Tracking) {
        self.t = t
        self.pose = pose
        self.tracking = tracking
    }
}

/// A room's own record (`rooms/<id>/room.json`), written when the room ends.
public struct RoomRecord: Codable, Sendable, Equatable {
    /// The white balance the room was scanned with, so every photo of it shares one colour.
    public struct WhiteBalance: Codable, Sendable, Equatable {
        /// Red, green and blue gains.
        public var gains: [Double]
        public var temperatureK: Double
        public var tint: Double
        /// False when the camera would not hold it, so colour may drift between photos.
        public var locked: Bool

        public init(gains: [Double], temperatureK: Double, tint: Double, locked: Bool) {
            self.gains = gains
            self.temperatureK = temperatureK
            self.tint = tint
            self.locked = locked
        }
    }

    public struct Counts: Codable, Sendable, Equatable {
        public var photos = 0
        public var stills = 0
        public var keyframes = 0
        public var tapeChecks = 0
        public var cards = 0
        public init() {}
    }

    public var id: String
    public var name: String
    public var startedAt: Date
    public var endedAt: Date?
    public var whiteBalance: WhiteBalance?
    public var counts: Counts

    public init(id: String, name: String, startedAt: Date, endedAt: Date? = nil, whiteBalance: WhiteBalance? = nil, counts: Counts = Counts()) {
        self.id = id
        self.name = name
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.whiteBalance = whiteBalance
        self.counts = counts
    }
}

/// Something that happened during a capture (`log/events.jsonl`), for working out later why
/// a capture came out the way it did.
public struct EventRecord: Codable, Sendable, Equatable {
    public enum Kind: String, Codable, Sendable {
        case trackingLost = "tracking_lost"
        case trackingResumed = "tracking_resumed"
        case trackingLimited = "tracking_limited"
        case worldJumped = "world_jumped"
        case thermal
        case memoryWarning = "memory_warning"
        case whiteBalanceLocked = "white_balance_locked"
        case whiteBalanceFailed = "white_balance_failed"
        case stillFailed = "still_failed"
        case scannerFailed = "scanner_failed"
        case writeFailed = "write_failed"
    }

    /// Seconds since the device booted.
    public var t: Double
    public var kind: Kind
    public var room: String?
    public var detail: String?
    public var value: Double?

    public init(t: Double, kind: Kind, room: String? = nil, detail: String? = nil, value: Double? = nil) {
        self.t = t
        self.kind = kind
        self.room = room
        self.detail = detail
        self.value = value
    }
}
