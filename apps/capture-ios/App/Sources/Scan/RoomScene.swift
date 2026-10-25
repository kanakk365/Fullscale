// A small 3D model of a scanned room, drawn with SceneKit from the scanner's room: walls,
// doors, windows, the floor and furniture boxes. The scan screen shows it live, with the
// phone's position, so people see the room take shape; the room screen lets them turn it.
import CaptureKit
import RoomPlan
import SceneKit
import SwiftUI

enum RoomScene {
    static func node(for room: CapturedRoom) -> SCNNode {
        let root = SCNNode()
        for floor in room.floors {
            if let node = floorNode(floor) { root.addChildNode(node) }
        }
        for wall in room.walls {
            root.addChildNode(box(wall.dimensions, depth: 0.04, transform: wall.transform, colour: UIColor(white: 0.93, alpha: 1)))
        }
        for door in room.doors {
            root.addChildNode(box(door.dimensions, depth: 0.07, transform: door.transform, colour: UIColor(red: 0.85, green: 0.55, blue: 0.25, alpha: 1)))
        }
        for window in room.windows {
            root.addChildNode(box(window.dimensions, depth: 0.07, transform: window.transform, colour: UIColor(red: 0.45, green: 0.7, blue: 0.95, alpha: 0.9)))
        }
        for opening in room.openings {
            root.addChildNode(box(opening.dimensions, depth: 0.07, transform: opening.transform, colour: UIColor(white: 0.6, alpha: 0.35)))
        }
        for object in room.objects {
            let node = SCNNode(geometry: SCNBox(width: CGFloat(object.dimensions.x), height: CGFloat(object.dimensions.y), length: CGFloat(object.dimensions.z), chamferRadius: 0.02))
            node.geometry?.firstMaterial = material(UIColor.brand.withAlphaComponent(0.75))
            node.simdTransform = object.transform
            root.addChildNode(node)
        }
        return root
    }

    /// A camera above and to one side of the model, far enough back to show all of it.
    static func frame(_ camera: SCNNode, on node: SCNNode, aspect: Double = 1) {
        let (low, high) = node.boundingBox
        let centre = SIMD3<Float>((low.x + high.x) / 2, (low.y + high.y) / 2, (low.z + high.z) / 2)
        let size = max(simd_length(SIMD3<Float>(high.x - low.x, high.y - low.y, high.z - low.z)), 2)
        let distance = size * Float(aspect < 1 ? 1.25 / aspect : 1.25)
        camera.simdPosition = centre + SIMD3<Float>(0, distance * 0.8, distance * 0.6)
        camera.simdLook(at: centre)
    }

    /// The phone, as a small arrow pointing where the camera looks.
    static func phoneMarker() -> SCNNode {
        let cone = SCNCone(topRadius: 0, bottomRadius: 0.16, height: 0.4)
        cone.firstMaterial = material(.systemOrange)
        let arrow = SCNNode(geometry: cone)
        // The cone points along +y; the camera looks along -z.
        arrow.eulerAngles.x = -.pi / 2
        let marker = SCNNode()
        marker.addChildNode(arrow)
        return marker
    }

    private static func box(_ size: simd_float3, depth: Float, transform: simd_float4x4, colour: UIColor) -> SCNNode {
        let node = SCNNode(geometry: SCNBox(width: CGFloat(size.x), height: CGFloat(size.y), length: CGFloat(depth), chamferRadius: 0))
        node.geometry?.firstMaterial = material(colour)
        node.simdTransform = transform
        return node
    }

    private static func floorNode(_ floor: CapturedRoom.Surface) -> SCNNode? {
        guard floor.polygonCorners.count >= 3 else { return nil }
        let path = UIBezierPath()
        path.move(to: CGPoint(x: CGFloat(floor.polygonCorners[0].x), y: CGFloat(floor.polygonCorners[0].y)))
        for corner in floor.polygonCorners.dropFirst() { path.addLine(to: CGPoint(x: CGFloat(corner.x), y: CGFloat(corner.y))) }
        path.close()
        let shape = SCNShape(path: path, extrusionDepth: 0.01)
        shape.firstMaterial = material(UIColor(red: 0.82, green: 0.76, blue: 0.68, alpha: 1))
        let node = SCNNode(geometry: shape)
        // The floor's own frame has its outline in x and y, with z up.
        node.simdTransform = floor.transform
        return node
    }

    private static func material(_ colour: UIColor) -> SCNMaterial {
        let m = SCNMaterial()
        m.diffuse.contents = colour
        m.lightingModel = .lambert
        m.isDoubleSided = true
        return m
    }
}

/// The live model on the scan screen, or a room to turn round on the room screen.
struct RoomModelView: UIViewRepresentable {
    let room: CapturedRoom?
    /// Changes each time the room changes, so the model is rebuilt only then.
    var version: Int = 0
    var phone: simd_float4x4?
    var interactive = false

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.backgroundColor = .clear
        view.antialiasingMode = .multisampling4X
        view.autoenablesDefaultLighting = true
        view.allowsCameraControl = interactive
        let scene = SCNScene()
        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = 40
        scene.rootNode.addChildNode(camera)
        scene.rootNode.addChildNode(context.coordinator.model)
        context.coordinator.marker.isHidden = true
        scene.rootNode.addChildNode(context.coordinator.marker)
        view.scene = scene
        view.pointOfView = camera
        context.coordinator.camera = camera
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        let c = context.coordinator
        if let room, c.version != version || c.model.childNodes.isEmpty {
            c.version = version
            c.model.childNodes.forEach { $0.removeFromParentNode() }
            c.model.addChildNode(RoomScene.node(for: room))
            // Reframe while scanning; once people turn the model themselves, leave it.
            if let camera = c.camera, !interactive || !c.framed {
                SCNTransaction.begin()
                SCNTransaction.animationDuration = interactive ? 0 : 0.5
                RoomScene.frame(camera, on: c.model, aspect: view.bounds.height > 0 ? Double(view.bounds.width / view.bounds.height) : 1)
                SCNTransaction.commit()
                c.framed = true
            }
        }
        if let phone {
            c.marker.isHidden = false
            c.marker.simdTransform = phone
        } else {
            c.marker.isHidden = true
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        let model = SCNNode()
        let marker = RoomScene.phoneMarker()
        var camera: SCNNode?
        var version = -1
        var framed = false
    }
}
