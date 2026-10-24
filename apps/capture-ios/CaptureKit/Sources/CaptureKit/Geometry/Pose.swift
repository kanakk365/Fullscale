// A camera's pose: camera-to-world, as 16 numbers in column-major order (translation in
// elements 12–14), which is how ARKit's simd_float4x4 columns and Three.js's
// Matrix4.fromArray read it. Stored as doubles; written to JSON as a plain list.
import Foundation

public struct Pose: Codable, Sendable, Equatable {
    public var m: [Double]

    public init(_ m: [Double]) {
        precondition(m.count == 16, "A pose has 16 numbers")
        self.m = m
    }

    public static let identity = Pose([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

    /// A pose turned by `yaw` radians about +Y (up) and moved to `position`.
    public static func standing(at position: [Double], yaw: Double) -> Pose {
        let c = cos(yaw)
        let s = sin(yaw)
        return Pose([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, position[0], position[1], position[2], 1])
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.singleValueContainer().decode([Double].self)
        guard values.count == 16 else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "A pose has 16 numbers, not \(values.count)"))
        }
        m = values
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(m)
    }

    public var position: [Double] { [m[12], m[13], m[14]] }

    /// Element at row r, column c of the 3 × 3 rotation.
    func r(_ row: Int, _ column: Int) -> Double { m[column * 4 + row] }

    /// How far the camera moved between two poses, in metres.
    public static func distance(_ a: Pose, _ b: Pose) -> Double {
        let p = a.position
        let q = b.position
        return ((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]) + (p[2] - q[2]) * (p[2] - q[2])).squareRoot()
    }

    /// How far the camera turned between two poses, in radians (the angle of the relative
    /// rotation, from the trace of Aᵀ·B).
    public static func turn(_ a: Pose, _ b: Pose) -> Double {
        var trace = 0.0
        for i in 0..<3 {
            for k in 0..<3 {
                trace += a.r(k, i) * b.r(k, i)
            }
        }
        return acos(max(-1, min(1, (trace - 1) / 2)))
    }
}

/// The motion blur a photo will have, predicted from how fast the camera moves: focal length
/// × exposure × (turning speed + moving speed ÷ 2). Dividing the moving speed by 2 treats the
/// scene as about 2 m away. It costs nothing per frame, unlike measuring sharpness.
public func predictedBlurPx(fx: Double, exposureS: Double, from: (pose: Pose, t: Double), to: (pose: Pose, t: Double)) -> Double {
    let dt = to.t - from.t
    guard dt > 0 else { return 0 }
    let turning = Pose.turn(from.pose, to.pose) / dt
    let moving = Pose.distance(from.pose, to.pose) / dt
    return fx * exposureS * (turning + moving / 2)
}
