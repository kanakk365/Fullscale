// Turning ARKit's frame data into the capture format's terms: poses, intrinsics, JPEGs and
// depth arrays. Pixel buffers are copied before being handed to the writer, because holding
// ARKit's own buffers starves its pool and freezes the camera.
import ARKit
import CaptureKit
import CoreImage

enum FrameData {
    static let ciContext = CIContext()

    static func pose(_ m: simd_float4x4) -> Pose {
        Pose([m.columns.0, m.columns.1, m.columns.2, m.columns.3].flatMap { [Double($0.x), Double($0.y), Double($0.z), Double($0.w)] })
    }

    /// ARKit's intrinsics matrix is column-major: fx and fy on the diagonal, the centre in
    /// the third column.
    static func intrinsics(_ k: simd_float3x3) -> Intrinsics {
        Intrinsics(fx: Double(k.columns.0.x), fy: Double(k.columns.1.y), cx: Double(k.columns.2.x), cy: Double(k.columns.2.y))
    }

    static func tracking(_ state: ARCamera.TrackingState) -> Tracking {
        switch state {
        case .normal: .normal
        case .limited: .limited
        case .notAvailable: .notAvailable
        }
    }

    static func reason(_ state: ARCamera.TrackingState) -> TrackingReason? {
        guard case .limited(let why) = state else { return nil }
        switch why {
        case .initializing: return .initializing
        case .relocalizing: return .relocalizing
        case .excessiveMotion: return .excessiveMotion
        case .insufficientFeatures: return .insufficientFeatures
        @unknown default: return .other
        }
    }

    /// A JPEG of a camera image, in the sensor's orientation (EXIF orientation 1).
    static func jpeg(_ buffer: CVPixelBuffer, quality: Double, maxWidth: Int? = nil) -> Data? {
        var image = CIImage(cvPixelBuffer: buffer)
        if let maxWidth, image.extent.width > CGFloat(maxWidth) {
            let s = CGFloat(maxWidth) / image.extent.width
            image = image.transformed(by: CGAffineTransform(scaleX: s, y: s))
        }
        let options: [CIImageRepresentationOption: Any] = [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality]
        return ciContext.jpegRepresentation(of: image, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, options: options)
    }

    /// Depth in metres and confidence levels, copied out of ARKit's buffers.
    static func depth(_ depth: ARDepthData) -> (metres: [Float], confidence: [UInt8], width: Int, height: Int) {
        let map = depth.depthMap
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        let width = CVPixelBufferGetWidth(map)
        let height = CVPixelBufferGetHeight(map)
        let rowBytes = CVPixelBufferGetBytesPerRow(map)
        var metres = [Float](repeating: 0, count: width * height)
        if let base = CVPixelBufferGetBaseAddress(map) {
            for y in 0..<height {
                let row = base.advanced(by: y * rowBytes).assumingMemoryBound(to: Float32.self)
                for x in 0..<width { metres[y * width + x] = row[x] }
            }
        }
        var confidence = [UInt8](repeating: 0, count: width * height)
        if let conf = depth.confidenceMap {
            CVPixelBufferLockBaseAddress(conf, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(conf, .readOnly) }
            if let base = CVPixelBufferGetBaseAddress(conf) {
                let confRow = CVPixelBufferGetBytesPerRow(conf)
                for y in 0..<height {
                    let row = base.advanced(by: y * confRow).assumingMemoryBound(to: UInt8.self)
                    for x in 0..<width { confidence[y * width + x] = row[x] }
                }
            }
        }
        return (metres, confidence, width, height)
    }
}

/// What is needed from a full-resolution still, copied out of its frame so the frame itself
/// is let go at once.
struct StillFrame: @unchecked Sendable {
    // Unchecked because of the image buffer, which nothing changes: it is only read, once,
    // by the JPEG encoder.
    let t: Double
    let pose: Pose
    let intrinsics: Intrinsics
    let width: Int
    let height: Int
    let exposureS: Double
    let evOffset: Double
    let exif: [String: Any]
    let image: CVPixelBuffer

    init(_ frame: ARFrame) {
        t = frame.timestamp
        pose = FrameData.pose(frame.camera.transform)
        intrinsics = FrameData.intrinsics(frame.camera.intrinsics)
        width = Int(frame.camera.imageResolution.width)
        height = Int(frame.camera.imageResolution.height)
        exposureS = frame.camera.exposureDuration
        evOffset = Double(frame.camera.exposureOffset)
        exif = frame.exifData
        image = frame.capturedImage
    }
}
