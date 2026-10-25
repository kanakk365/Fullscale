// The live camera picture, with what the depth sensor has captured painted over it as a light
// mesh: surfaces turn teal as they are scanned, so gaps stand out and people know where to
// point the phone next.
import ARKit
import SceneKit
import SwiftUI

struct ARCameraView: UIViewRepresentable {
    let session: ARSession
    var showsCoverage: Bool

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.session = session
        view.automaticallyUpdatesLighting = false
        view.rendersCameraGrain = false
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ view: ARSCNView, context: Context) {
        context.coordinator.setVisible(showsCoverage)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// Builds a mesh node for each piece of mesh ARKit finds. ARKit calls it on its rendering
    /// thread, so it touches nothing else.
    final class Coordinator: NSObject, ARSCNViewDelegate, @unchecked Sendable {
        private let lock = NSLock()
        private var visible = true

        func setVisible(_ shown: Bool) {
            lock.withLock { visible = shown }
        }

        private var isVisible: Bool { lock.withLock { visible } }

        nonisolated func renderer(_ renderer: any SCNSceneRenderer, nodeFor anchor: ARAnchor) -> SCNNode? {
            guard let mesh = anchor as? ARMeshAnchor else { return nil }
            let node = SCNNode()
            node.addChildNode(Self.coverage(mesh.geometry))
            return node
        }

        nonisolated func renderer(_ renderer: any SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
            guard let mesh = anchor as? ARMeshAnchor else { return }
            node.childNodes.forEach { $0.removeFromParentNode() }
            node.addChildNode(Self.coverage(mesh.geometry))
        }

        nonisolated func renderer(_ renderer: any SCNSceneRenderer, updateAtTime time: TimeInterval) {
            renderer.scene?.rootNode.isHidden = !isVisible
        }

        private static func coverage(_ geometry: ARMeshGeometry) -> SCNNode {
            let vertices = SCNGeometrySource(
                buffer: geometry.vertices.buffer, vertexFormat: geometry.vertices.format, semantic: .vertex,
                vertexCount: geometry.vertices.count, dataOffset: geometry.vertices.offset, dataStride: geometry.vertices.stride
            )
            let faces = SCNGeometryElement(
                buffer: geometry.faces.buffer, primitiveType: .triangles,
                primitiveCount: geometry.faces.count, bytesPerIndex: geometry.faces.bytesPerIndex
            )
            let fill = SCNGeometry(sources: [vertices], elements: [faces])
            fill.firstMaterial = material(alpha: 0.28, lines: false)
            let edges = SCNGeometry(sources: [vertices], elements: [faces])
            edges.firstMaterial = material(alpha: 0.55, lines: true)
            let node = SCNNode(geometry: fill)
            node.addChildNode(SCNNode(geometry: edges))
            return node
        }

        private static func material(alpha: CGFloat, lines: Bool) -> SCNMaterial {
            let m = SCNMaterial()
            m.diffuse.contents = UIColor.brand.withAlphaComponent(alpha)
            m.lightingModel = .constant
            m.fillMode = lines ? .lines : .fill
            m.isDoubleSided = true
            // Drawn over the camera picture without hiding what is behind a nearer surface.
            m.writesToDepthBuffer = !lines
            m.blendMode = .alpha
            return m
        }
    }
}
