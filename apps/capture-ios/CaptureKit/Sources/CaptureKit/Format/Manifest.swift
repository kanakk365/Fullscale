// The capture's manifest (docs/capture-format.md): what was captured, on what, and how it
// ended. Field names and units match the format document exactly; the computer-side
// importer reads this file.
import Foundation

public struct Manifest: Codable, Sendable, Equatable {
    public static let currentFormat = "fullscale-capture/1"
    /// Grows when fields are added; readers ignore fields they don't know.
    public static let currentRevision = 2

    public enum Status: String, Codable, Sendable { case recording, complete, interrupted }

    public struct Clock: Codable, Sendable, Equatable {
        /// Seconds since the device booted (the AR session's clock) when the capture began.
        public var uptimeAtStart: Double
        public var utcAtStart: Date
        public var uptimeAtEnd: Double?
        public var utcAtEnd: Date?

        public init(uptimeAtStart: Double, utcAtStart: Date, uptimeAtEnd: Double? = nil, utcAtEnd: Date? = nil) {
            self.uptimeAtStart = uptimeAtStart
            self.utcAtStart = utcAtStart
            self.uptimeAtEnd = uptimeAtEnd
            self.utcAtEnd = utcAtEnd
        }
    }

    public struct App: Codable, Sendable, Equatable {
        public var name: String
        public var version: String
        public var build: String?
        public init(name: String, version: String, build: String? = nil) {
            self.name = name
            self.version = version
            self.build = build
        }
    }

    public struct Device: Codable, Sendable, Equatable {
        /// The model identifier (e.g. "iPhone18,1"), never the name the owner gave the phone.
        public var model: String
        public var os: String
        public var osVersion: String
        public var lidar: Bool
        public init(model: String, os: String, osVersion: String, lidar: Bool) {
            self.model = model
            self.os = os
            self.osVersion = osVersion
            self.lidar = lidar
        }
    }

    public struct AR: Codable, Sendable, Equatable {
        public struct VideoFormat: Codable, Sendable, Equatable {
            public var width: Int
            public var height: Int
            public var fps: Int
            public init(width: Int, height: Int, fps: Int) {
                self.width = width
                self.height = height
                self.fps = fps
            }
        }

        public var videoFormat: VideoFormat
        public var highResolutionStills: Bool
        public init(videoFormat: VideoFormat, highResolutionStills: Bool) {
            self.videoFormat = videoFormat
            self.highResolutionStills = highResolutionStills
        }
    }

    /// A space or a room in the phone's library ("Home", "Bedroom"), so the computer knows
    /// which room of which space a scan is of.
    public struct LibraryRef: Codable, Sendable, Equatable {
        public var id: String
        public var name: String
        public init(id: String, name: String) {
            self.id = id
            self.name = name
        }
    }

    /// The earlier scan a room's scan adds to: that capture and its room.
    public struct AddsTo: Codable, Sendable, Equatable {
        public var capture: String
        public var room: String
        public init(capture: String, room: String) {
            self.capture = capture
            self.room = room
        }
    }

    public struct Room: Codable, Sendable, Equatable {
        public var id: String
        public var name: String
        /// The room's folder, relative to the capture.
        public var dir: String
        public var startedAt: Date
        public var endedAt: Date?
        /// The library room this is a scan of.
        public var spaceRoom: LibraryRef?
        /// Set when this scan adds to an earlier one of the same room, lined up with it.
        public var addsTo: AddsTo?
        public init(id: String, name: String, dir: String, startedAt: Date, endedAt: Date? = nil, spaceRoom: LibraryRef? = nil, addsTo: AddsTo? = nil) {
            self.id = id
            self.name = name
            self.dir = dir
            self.startedAt = startedAt
            self.endedAt = endedAt
            self.spaceRoom = spaceRoom
            self.addsTo = addsTo
        }
    }

    public struct Counts: Codable, Sendable, Equatable {
        public struct DepthSkipped: Codable, Sendable, Equatable {
            public var motion = 0
            public var busy = 0
            public var noDepth = 0
            public var writeFailed = 0
            public init() {}
        }

        public var photos = 0
        public var keyframes = 0
        public var poses = 0
        public var tapeChecks = 0
        public var cards = 0
        public var depthSkipped = DepthSkipped()
        public init() {}
    }

    public struct Alignment: Codable, Sendable, Equatable {
        public enum Method: String, Codable, Sendable { case first, relocalized, unaligned }
        public var method: Method
        public var residualM: Double?
        public init(method: Method, residualM: Double? = nil) {
            self.method = method
            self.residualM = residualM
        }
    }

    public var format = Manifest.currentFormat
    public var revision = Manifest.currentRevision
    public var id: String
    public var status: Status
    public var createdAt: Date
    public var endedAt: Date?
    public var clock: Clock?
    public var app: App?
    public var device: Device?
    /// 1 LiDAR + scanner, 2 camera only, 3 Android ARCore, 4 photos only.
    public var tier: Int?
    public var ar: AR?
    /// The library space the capture's rooms belong to.
    public var space: LibraryRef?
    public var rooms: [Room] = []
    public var counts = Counts()
    public var alignment: Alignment?

    public init(id: String, createdAt: Date, tier: Int) {
        self.id = id
        self.status = .recording
        self.createdAt = createdAt
        self.tier = tier
    }
}
