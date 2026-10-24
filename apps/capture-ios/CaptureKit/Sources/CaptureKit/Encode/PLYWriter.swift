// The LiDAR mesh as a binary little-endian PLY file, written in chunks so a large mesh never
// needs a second copy in memory. Per vertex: position and normal (world metres), colour, and
// the room it was seen in; per face: three vertex indices and ARKit's surface class.
import Foundation

public struct MeshVertex: Sendable, Equatable {
    public var position: (Float, Float, Float)
    public var normal: (Float, Float, Float)
    public var colour: (UInt8, UInt8, UInt8)
    /// Index into the manifest's rooms; 255 when not in a room.
    public var room: UInt8

    public init(position: (Float, Float, Float), normal: (Float, Float, Float), colour: (UInt8, UInt8, UInt8), room: UInt8) {
        self.position = position
        self.normal = normal
        self.colour = colour
        self.room = room
    }

    public static func == (a: MeshVertex, b: MeshVertex) -> Bool {
        a.position == b.position && a.normal == b.normal && a.colour == b.colour && a.room == b.room
    }
}

public struct MeshFace: Sendable, Equatable {
    public var indices: (UInt32, UInt32, UInt32)
    /// ARKit's mesh classes: 0 none, 1 wall, 2 floor, 3 ceiling, 4 table, 5 seat, 6 window, 7 door.
    public var classification: UInt8

    public init(indices: (UInt32, UInt32, UInt32), classification: UInt8) {
        self.indices = indices
        self.classification = classification
    }

    public static func == (a: MeshFace, b: MeshFace) -> Bool {
        a.indices == b.indices && a.classification == b.classification
    }
}

public enum PLY {
    static func header(vertices: Int, faces: Int) -> String {
        """
        ply
        format binary_little_endian 1.0
        comment Fullscale capture mesh: world metres, +Y up
        element vertex \(vertices)
        property float x
        property float y
        property float z
        property float nx
        property float ny
        property float nz
        property uchar red
        property uchar green
        property uchar blue
        property uchar room
        element face \(faces)
        property list uchar uint vertex_indices
        property uchar classification
        end_header

        """
    }

    /// Write a mesh to `url`, replacing any file there only once the new one is complete.
    public static func write(vertices: [MeshVertex], faces: [MeshFace], to url: URL) throws {
        let partial = url.appendingPathExtension("partial")
        FileManager.default.createFile(atPath: partial.path, contents: nil)
        let handle = try FileHandle(forWritingTo: partial)
        defer { try? handle.close() }
        try handle.write(contentsOf: Data(header(vertices: vertices.count, faces: faces.count).utf8))
        var chunk = Data(capacity: 1 << 20)
        func flushIfFull() throws {
            if chunk.count >= 1 << 20 {
                try handle.write(contentsOf: chunk)
                chunk.removeAll(keepingCapacity: true)
            }
        }
        for v in vertices {
            for f in [v.position.0, v.position.1, v.position.2, v.normal.0, v.normal.1, v.normal.2] { chunk.appendLittleEndian(f.bitPattern) }
            chunk.append(contentsOf: [v.colour.0, v.colour.1, v.colour.2, v.room])
            try flushIfFull()
        }
        for f in faces {
            chunk.append(3)
            for i in [f.indices.0, f.indices.1, f.indices.2] { chunk.appendLittleEndian(i) }
            chunk.append(f.classification)
            try flushIfFull()
        }
        try handle.write(contentsOf: chunk)
        try handle.synchronize()
        try handle.close()
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        try FileManager.default.moveItem(at: partial, to: url)
    }

    /// Read a mesh written by `write` (for tests and checks).
    public static func read(_ data: Data) throws -> (vertices: [MeshVertex], faces: [MeshFace]) {
        guard let end = data.range(of: Data("end_header\n".utf8)) else { throw CocoaError(.fileReadCorruptFile) }
        let head = String(decoding: data[..<end.lowerBound], as: UTF8.self)
        func count(_ element: String) -> Int {
            head.split(separator: "\n").first { $0.hasPrefix("element \(element) ") }.flatMap { Int($0.split(separator: " ")[2]) } ?? 0
        }
        var reader = LittleEndianReader(data: data, at: end.upperBound)
        var vertices: [MeshVertex] = []
        for _ in 0..<count("vertex") {
            let p = (reader.float(), reader.float(), reader.float())
            let n = (reader.float(), reader.float(), reader.float())
            vertices.append(MeshVertex(position: p, normal: n, colour: (reader.byte(), reader.byte(), reader.byte()), room: reader.byte()))
        }
        var faces: [MeshFace] = []
        for _ in 0..<count("face") {
            guard reader.byte() == 3 else { throw CocoaError(.fileReadCorruptFile) }
            faces.append(MeshFace(indices: (reader.uint32(), reader.uint32(), reader.uint32()), classification: reader.byte()))
        }
        return (vertices, faces)
    }
}

extension Data {
    mutating func appendLittleEndian<T: FixedWidthInteger>(_ value: T) {
        Swift.withUnsafeBytes(of: value.littleEndian) { append(contentsOf: $0) }
    }
}

struct LittleEndianReader {
    let data: Data
    var at: Data.Index

    mutating func byte() -> UInt8 {
        defer { at += 1 }
        return data[at]
    }

    mutating func uint32() -> UInt32 {
        var value: UInt32 = 0
        for k in 0..<4 { value |= UInt32(data[at + k]) << (8 * k) }
        at += 4
        return value
    }

    mutating func float() -> Float { Float(bitPattern: uint32()) }
}
