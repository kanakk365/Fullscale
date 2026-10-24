// Names in a capture: the capture's id, and relative paths that can't leave its folder.
import Foundation

public enum CaptureNaming {
    /// Letters and digits that can't be confused with each other when read aloud or typed.
    static let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    /// "20261024T101200Z-7KQ2": the start time in UTC and four random characters.
    public static func captureID(at date: Date, random: inout some RandomNumberGenerator) -> String {
        let formatter = DateFormatter()
        // A fixed locale and calendar: the phone's own settings must not change the id.
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        let suffix = String((0..<4).map { _ in alphabet.randomElement(using: &random)! })
        return "\(formatter.string(from: date))-\(suffix)"
    }

    /// A path inside a capture: relative, "/"-separated, no empty, ".", ".." or hidden parts.
    public static func isSafe(_ path: String) -> Bool {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0") else { return false }
        return path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { part in
            !part.isEmpty && !part.hasPrefix(".")
        }
    }
}

/// Dates in a capture are UTC with whole seconds, ending in "Z".
public enum CaptureDates {
    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }

    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            let plain = ISO8601DateFormatter()
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = plain.date(from: text) ?? fractional.date(from: text) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a UTC date: \(text)"))
        }
        return decoder
    }
}
