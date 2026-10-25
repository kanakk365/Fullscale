// The phone's library: spaces ("Home", "Office"), their rooms, and which captures scanned each
// room. Captures stay the record of what was scanned; the library only organises them, so a
// room scanned in parts, or scanned more later, lists every capture that saw it.
import Foundation

public struct Library: Codable, Sendable, Equatable {
    public static let currentFormat = "fullscale-library/1"

    public enum Kind: String, Codable, Sendable, CaseIterable {
        case home, office, shop, other
    }

    public struct Space: Codable, Sendable, Equatable, Identifiable {
        public var id: String
        public var name: String
        public var kind: Kind
        public var createdAt: Date
        public var rooms: [Room] = []

        /// The floor area of every room, where known.
        public var floorAreaM2: Double? {
            let areas = rooms.compactMap(\.latest?.summary?.floorAreaM2)
            return areas.isEmpty ? nil : areas.reduce(0, +)
        }

        public var lastScannedAt: Date? { rooms.compactMap(\.latest?.scannedAt).max() }
    }

    public struct Room: Codable, Sendable, Equatable, Identifiable {
        public var id: String
        public var name: String
        public var createdAt: Date
        /// Oldest first.
        public var scans: [Scan] = []

        public var latest: Scan? { scans.last }
    }

    /// One capture's scan of a room: the capture's folder name and the room's id inside it.
    public struct Scan: Codable, Sendable, Equatable {
        public var capture: String
        public var room: String
        public var scannedAt: Date
        /// The scan adds to the room's earlier scans, lined up with them.
        public var addsToEarlier: Bool
        public var summary: RoomSummary?

        public init(capture: String, room: String, scannedAt: Date, addsToEarlier: Bool, summary: RoomSummary?) {
            self.capture = capture
            self.room = room
            self.scannedAt = scannedAt
            self.addsToEarlier = addsToEarlier
            self.summary = summary
        }
    }

    public var format = Library.currentFormat
    public var spaces: [Space] = []

    public init() {}

    // ---------- changes ----------

    @discardableResult
    public mutating func addSpace(name: String, kind: Kind, now: Date, id: String = UUID().uuidString) -> String {
        spaces.append(Space(id: id, name: Self.cleaned(name, or: Self.defaultName(kind)), kind: kind, createdAt: now))
        return id
    }

    @discardableResult
    public mutating func addRoom(to space: String, name: String, now: Date, id: String = UUID().uuidString) throws -> String {
        let s = try index(of: space)
        let wanted = Self.cleaned(name, or: "Room \(spaces[s].rooms.count + 1)")
        spaces[s].rooms.append(Room(id: id, name: uniqueName(wanted, in: spaces[s]), createdAt: now))
        return id
    }

    public mutating func record(_ scan: Scan, room: String, space: String) throws {
        let (s, r) = try indices(space: space, room: room)
        spaces[s].rooms[r].scans.append(scan)
    }

    public mutating func rename(space: String, to name: String) throws {
        let s = try index(of: space)
        spaces[s].name = Self.cleaned(name, or: spaces[s].name)
    }

    public mutating func rename(room: String, in space: String, to name: String) throws {
        let (s, r) = try indices(space: space, room: room)
        let wanted = Self.cleaned(name, or: spaces[s].rooms[r].name)
        spaces[s].rooms[r].name = wanted == spaces[s].rooms[r].name ? wanted : uniqueName(wanted, in: spaces[s])
    }

    /// Removes the space from the library; its captures are returned so they can be deleted.
    public mutating func removeSpace(_ space: String) throws -> Set<String> {
        let s = try index(of: space)
        let captures = Set(spaces[s].rooms.flatMap { $0.scans.map(\.capture) })
        spaces.remove(at: s)
        return captures.subtracting(capturesInUse)
    }

    /// Removes the room; returns its captures that no other room uses, so they can be deleted.
    public mutating func removeRoom(_ room: String, in space: String) throws -> Set<String> {
        let (s, r) = try indices(space: space, room: room)
        let captures = Set(spaces[s].rooms[r].scans.map(\.capture))
        spaces[s].rooms.remove(at: r)
        return captures.subtracting(capturesInUse)
    }

    /// Forget scans whose capture folder is gone.
    public mutating func keepOnly(captures existing: Set<String>) {
        for s in spaces.indices {
            for r in spaces[s].rooms.indices {
                spaces[s].rooms[r].scans.removeAll { !existing.contains($0.capture) }
            }
        }
    }

    // ---------- questions ----------

    public func space(_ id: String) -> Space? { spaces.first { $0.id == id } }

    public var capturesInUse: Set<String> { Set(spaces.flatMap { $0.rooms.flatMap { $0.scans.map(\.capture) } }) }

    // ---------- helpers ----------

    private func index(of space: String) throws -> Int {
        guard let s = spaces.firstIndex(where: { $0.id == space }) else { throw LibraryError.noSuchSpace(space) }
        return s
    }

    private func indices(space: String, room: String) throws -> (Int, Int) {
        let s = try index(of: space)
        guard let r = spaces[s].rooms.firstIndex(where: { $0.id == room }) else { throw LibraryError.noSuchRoom(room) }
        return (s, r)
    }

    /// "Bedroom" again in the same space becomes "Bedroom 2": names are how people tell rooms apart.
    private func uniqueName(_ name: String, in space: Space) -> String {
        let taken = Set(space.rooms.map { $0.name.lowercased() })
        guard taken.contains(name.lowercased()) else { return name }
        var n = 2
        while taken.contains("\(name) \(n)".lowercased()) { n += 1 }
        return "\(name) \(n)"
    }

    static func cleaned(_ name: String, or fallback: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : String(trimmed.prefix(60))
    }

    public static func defaultName(_ kind: Kind) -> String {
        switch kind {
        case .home: "Home"
        case .office: "Office"
        case .shop: "Shop"
        case .other: "Space"
        }
    }

    /// Room names offered when starting a scan.
    public static func suggestedRooms(_ kind: Kind) -> [String] {
        switch kind {
        case .home: ["Living room", "Bedroom", "Kitchen", "Bathroom", "Dining room", "Hall", "Study", "Balcony"]
        case .office: ["Office", "Meeting room", "Reception", "Kitchen", "Corridor", "Bathroom"]
        case .shop: ["Shop floor", "Store room", "Counter", "Fitting room", "Bathroom"]
        case .other: ["Room", "Hall", "Store room"]
        }
    }
}

public enum LibraryError: Error, Equatable, CustomStringConvertible {
    case noSuchSpace(String)
    case noSuchRoom(String)

    public var description: String {
        switch self {
        case .noSuchSpace(let id): "There is no space \(id) in the library."
        case .noSuchRoom(let id): "There is no room \(id) in that space."
        }
    }
}
