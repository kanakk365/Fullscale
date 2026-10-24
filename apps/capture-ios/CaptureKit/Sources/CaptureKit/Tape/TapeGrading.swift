// How a tape value compares with the scan. The phone never rescales anything: it records
// both numbers, and the computer decides which checks correct the model and which are kept
// back to test it.
import Foundation

public enum TapeBand: String, Sendable, Codable {
    case green, amber, red
}

public enum TapeGrading {
    /// Tape values outside this range are almost certainly typos.
    public static let minM = 0.2
    public static let maxM = 20.0
    /// Differences above this many percent are confirmed with the person before saving.
    public static let confirmAbovePercent = 10.0
    /// Allows for float noise at the band edges (1.98 m against 2.00 m is exactly 2 cm).
    static let edge = 1e-9

    /// Green within 1% and 2 cm; amber within 2% or 5 cm; red beyond. The studio grades the
    /// same way (fixtures/tape-checks.json).
    public static func band(scanM: Double, tapeM: Double) -> TapeBand {
        let off = abs(scanM - tapeM)
        let share = off / tapeM
        if off <= 0.02 + edge && share <= 0.01 + edge { return .green }
        if off <= 0.05 + edge || share <= 0.02 + edge { return .amber }
        return .red
    }

    public static func isPlausible(tapeM: Double) -> Bool {
        tapeM >= minM && tapeM <= maxM
    }

    public static func needsConfirmation(scanM: Double, tapeM: Double) -> Bool {
        abs(scanM - tapeM) / tapeM * 100 > confirmAbovePercent
    }
}
