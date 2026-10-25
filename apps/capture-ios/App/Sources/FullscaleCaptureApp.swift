// Fullscale's capture app: scan the rooms of a space with the camera and LiDAR, check a few
// lengths with a tape, and send the scans to the computer, where an AI agent turns them into
// a 3D model to redesign.
import SwiftUI

@main
struct FullscaleCaptureApp: App {
    @State private var store = LibraryStore()

    var body: some Scene {
        WindowGroup {
            LibraryView()
                .environment(store)
                .tint(.brand)
        }
    }
}
