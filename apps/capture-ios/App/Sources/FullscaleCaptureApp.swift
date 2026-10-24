// Fullscale's capture app: scan rooms with the camera (and LiDAR where the phone has it), add
// a few tape measurements, and share the capture with the computer.
import SwiftUI

@main
struct FullscaleCaptureApp: App {
    var body: some Scene {
        WindowGroup {
            CapturesView()
        }
    }
}
