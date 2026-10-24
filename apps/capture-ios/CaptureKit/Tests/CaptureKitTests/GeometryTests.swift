import Foundation
import Testing
@testable import CaptureKit

@Suite("Poses and blur")
struct GeometryTests {
    @Test("predicts 25 px of blur for a 1 rad/s turn at 1/60 s with a 1500 px lens")
    func blurFromTurning() {
        let blur = predictedBlurPx(fx: 1500, exposureS: 1.0 / 60, from: (.standing(at: [0, 1.5, 0], yaw: 0), 0), to: (.standing(at: [0, 1.5, 0], yaw: 0.1), 0.1))
        #expect(abs(blur - 25) < 1e-9)
    }

    @Test("measures movement and turn between poses")
    func distanceAndTurn() {
        let a = Pose.standing(at: [0, 0, 0], yaw: 0)
        let b = Pose.standing(at: [3, 0, 4], yaw: .pi / 2)
        #expect(abs(Pose.distance(a, b) - 5) < 1e-12)
        #expect(abs(Pose.turn(a, b) - .pi / 2) < 1e-9)
    }

    @Test("scales a camera's intrinsics with its image")
    func intrinsicsScale() {
        let k = Intrinsics(fx: 1500, fy: 1500, cx: 960, cy: 720).scaled(from: (1920, 1440), to: (640, 480))
        #expect(k == Intrinsics(fx: 500, fy: 500, cx: 320, cy: 240))
    }
}
