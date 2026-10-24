// The camera behind the AR session: its colour and exposure settings, recorded with every
// photo, and its white balance, locked for each room (see CaptureKit's WhiteBalanceLock for
// why). ARKit lets an app change these through the camera it uses; the room scanner may
// reset them when it reconfigures the session, so the lock is checked and put back.
import ARKit
import AVFoundation
import CaptureKit

@MainActor
final class CameraControl {
    struct Reading {
        var gains: [Double]
        var temperatureK: Double
        var tint: Double
        var iso: Double
        var whiteBalanceLocked: Bool
        var exposureLocked: Bool
    }

    private var device: AVCaptureDevice? { ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera }
    /// The gains the current room is locked to.
    private var roomGains: AVCaptureDevice.WhiteBalanceGains?
    private var lastCheck = 0.0

    /// The camera's settings now. ISO comes from the frame's own EXIF when it has one.
    func reading(exif: [String: Any]? = nil) -> Reading? {
        guard let device else { return nil }
        let gains = device.deviceWhiteBalanceGains
        let colour = device.temperatureAndTintValues(for: gains)
        return Reading(
            gains: [Double(gains.redGain), Double(gains.greenGain), Double(gains.blueGain)],
            temperatureK: Double(colour.temperature),
            tint: Double(colour.tint),
            iso: Self.iso(exif) ?? Double(device.iso),
            whiteBalanceLocked: device.whiteBalanceMode == .locked,
            exposureLocked: device.exposureMode == .locked
        )
    }

    /// Lock the white balance where the camera has settled, for the room being scanned.
    /// Returns the white balance locked, or nil when the camera would not lock.
    func lockForRoom() -> Reading? {
        guard let device, device.isLockingWhiteBalanceWithCustomDeviceGainsSupported else { return nil }
        let now = device.deviceWhiteBalanceGains
        let clamped = WhiteBalanceLock.clamp([Double(now.redGain), Double(now.greenGain), Double(now.blueGain)], max: Double(device.maxWhiteBalanceGain))
        let gains = AVCaptureDevice.WhiteBalanceGains(redGain: Float(clamped[0]), greenGain: Float(clamped[1]), blueGain: Float(clamped[2]))
        guard Self.lock(device, to: gains) else { return nil }
        roomGains = gains
        return reading()
    }

    /// Put the room's lock back if something undid it; checked at most once a second.
    /// Returns false when the lock was lost and could not be put back.
    func keepLocked(now: Double) -> Bool {
        guard let device, let roomGains, now - lastCheck >= 1 else { return true }
        lastCheck = now
        guard device.whiteBalanceMode != .locked else { return true }
        return Self.lock(device, to: roomGains)
    }

    /// Back to automatic white balance between rooms.
    func unlock() {
        roomGains = nil
        guard let device, device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) else { return }
        do {
            try device.lockForConfiguration()
            device.whiteBalanceMode = .continuousAutoWhiteBalance
            device.unlockForConfiguration()
        } catch {
            // The next room locks its own white balance anyway.
        }
    }

    private static func lock(_ device: AVCaptureDevice, to gains: AVCaptureDevice.WhiteBalanceGains) -> Bool {
        do {
            try device.lockForConfiguration()
            device.setWhiteBalanceModeLocked(with: gains)
            device.unlockForConfiguration()
            return true
        } catch {
            return false
        }
    }

    /// ISO from a frame's EXIF, which may hold the EXIF keys directly or under "{Exif}".
    private static func iso(_ exif: [String: Any]?) -> Double? {
        guard let exif else { return nil }
        let key = kCGImagePropertyExifISOSpeedRatings as String
        let values = exif[key] ?? (exif[kCGImagePropertyExifDictionary as String] as? [String: Any])?[key]
        return (values as? [NSNumber])?.first?.doubleValue
    }
}
