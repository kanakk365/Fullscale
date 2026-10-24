// One white balance per room. Left on auto, the camera shifts colour as it turns from a
// window to a lamp, and the same wall comes out a different colour in each photo, so the
// colour is locked once the camera has settled in the room and unlocked when the room ends.
import Foundation

public enum WhiteBalanceLock {
    /// Gains the camera accepts: each between 1 and the camera's maximum. Out-of-range gains
    /// don't fail politely; the camera stops the app.
    public static func clamp(_ gains: [Double], max: Double) -> [Double] {
        gains.map { Swift.min(Swift.max($0, 1), Swift.max(max, 1)) }
    }
}
