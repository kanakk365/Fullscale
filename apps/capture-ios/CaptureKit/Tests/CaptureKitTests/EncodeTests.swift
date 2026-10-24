import Foundation
import Testing
@testable import CaptureKit

@Suite("Encoding")
struct EncodeTests {
    @Test("depth comes back to the millimetre, and bad values become 0")
    func depthRoundTrip() throws {
        let metres: [Float] = [0.5, 2.3456, 7.9994, .nan, -1, 70, 0]
        let back = try DepthEncoding.decodeDepth(try DepthEncoding.encodeDepth(metres))
        #expect(back == [0.5, 2.346, 7.999, 0, 0, 0, 0])
    }

    @Test("writes raw DEFLATE, not zlib, as the format says")
    func rawDeflate() throws {
        let data = try DepthEncoding.encodeDepth([Float](repeating: 1.5, count: 1000))
        // A zlib stream would start with 0x78; raw DEFLATE never carries that header.
        #expect(data.first != 0x78)
        #expect(data.count < 2000)
    }

    @Test("confidence is kept to 0, 1 or 2")
    func confidence() throws {
        #expect(try DepthEncoding.decodeConfidence(try DepthEncoding.encodeConfidence([0, 1, 2, 9])) == [0, 1, 2, 2])
    }

    @Test("a mesh survives being written and read back")
    func plyRoundTrip() throws {
        let vertices = [
            MeshVertex(position: (0, 0, 0), normal: (0, 1, 0), colour: (200, 100, 50), room: 0),
            MeshVertex(position: (1, 0, 0), normal: (0, 1, 0), colour: (1, 2, 3), room: 0),
            MeshVertex(position: (0, 0, 1), normal: (0, 1, 0), colour: (4, 5, 6), room: 255),
        ]
        let faces = [MeshFace(indices: (0, 1, 2), classification: 2)]
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("mesh-\(UUID().uuidString).ply")
        defer { try? FileManager.default.removeItem(at: url) }
        try PLY.write(vertices: vertices, faces: faces, to: url)
        let back = try PLY.read(Data(contentsOf: url))
        #expect(back.vertices == vertices)
        #expect(back.faces == faces)
    }
}
