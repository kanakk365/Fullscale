// swift-tools-version: 6.0
// CaptureKit: everything in the capture app that doesn't need the camera — the capture
// format, the rules for which frames and photos to keep, tape checks, encoding and the
// bundle writer — so it builds and is tested on a Mac without a phone.
import PackageDescription

let package = Package(
    name: "CaptureKit",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "CaptureKit", targets: ["CaptureKit"])],
    targets: [
        .target(name: "CaptureKit"),
        .testTarget(name: "CaptureKitTests", dependencies: ["CaptureKit"]),
    ]
)
