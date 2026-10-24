// The LiDAR mesh anchors as one world-space mesh, for mesh/session.ply.
import ARKit
import CaptureKit

enum MeshExport {
    static func mesh(from anchors: [(anchor: ARMeshAnchor, room: UInt8)]) -> (vertices: [MeshVertex], faces: [MeshFace]) {
        var vertices: [MeshVertex] = []
        var faces: [MeshFace] = []
        for (anchor, room) in anchors {
            let geometry = anchor.geometry
            let base = UInt32(vertices.count)
            let toWorld = anchor.transform
            let turn = simd_float3x3(columns: (simd_make_float3(toWorld.columns.0), simd_make_float3(toWorld.columns.1), simd_make_float3(toWorld.columns.2)))
            for i in 0..<geometry.vertices.count {
                let local = float3(geometry.vertices, i)
                let world = toWorld * SIMD4<Float>(local, 1)
                var normal = turn * float3(geometry.normals, i)
                if !normal.x.isFinite || !normal.y.isFinite || !normal.z.isFinite { normal = .zero }
                vertices.append(MeshVertex(position: (world.x, world.y, world.z), normal: (normal.x, normal.y, normal.z), colour: (180, 180, 180), room: room))
            }
            let element = geometry.faces
            for f in 0..<element.count {
                let i = (0..<3).map { k in base + index(element, face: f, corner: k) }
                faces.append(MeshFace(indices: (i[0], i[1], i[2]), classification: classification(geometry, face: f)))
            }
        }
        return (vertices, faces)
    }

    private static func float3(_ source: ARGeometrySource, _ i: Int) -> SIMD3<Float> {
        let pointer = source.buffer.contents().advanced(by: source.offset + source.stride * i)
        return pointer.assumingMemoryBound(to: SIMD3<Float>.self).pointee
    }

    private static func index(_ element: ARGeometryElement, face: Int, corner: Int) -> UInt32 {
        let at = element.buffer.contents().advanced(by: (face * element.indexCountPerPrimitive + corner) * element.bytesPerIndex)
        return element.bytesPerIndex == 4 ? at.assumingMemoryBound(to: UInt32.self).pointee : UInt32(at.assumingMemoryBound(to: UInt16.self).pointee)
    }

    private static func classification(_ geometry: ARMeshGeometry, face: Int) -> UInt8 {
        guard let source = geometry.classification else { return 0 }
        return source.buffer.contents().advanced(by: source.offset + source.stride * face).assumingMemoryBound(to: UInt8.self).pointee
    }
}
