// Reading a length the way people type it: "3.41", "341 cm", "1m80", "11' 2\"", "2' 6 1/2\"".
// It follows the studio's reader exactly (the shared cases are in fixtures/tape-checks.json),
// so a tape value typed on the phone means the same on the computer. Anything that could be
// read two ways, like "3,41", is refused rather than guessed.
import Foundation

public enum LengthUnit: String, Sendable, CaseIterable {
    case m, cm, mm, ft, `in`

    var metres: Double {
        switch self {
        case .m: 1
        case .cm: 0.01
        case .mm: 0.001
        case .ft: 0.3048
        case .in: 0.0254
        }
    }
}

public struct LengthError: Error, Equatable, CustomStringConvertible {
    public let input: String
    public let reason: String

    public init(input: String, reason: String) {
        self.input = input
        self.reason = reason
    }

    public var description: String { "Can't read \"\(input)\" as a length: \(reason). Try \"3.5 m\", \"350 cm\" or \"11' 6\\\"\"." }
}

public enum LengthParser {
    private static let metricWords: [String: LengthUnit] = ["m": .m, "metre": .m, "metres": .m, "meter": .m, "meters": .m, "cm": .cm, "mm": .mm]
    private static let number = #"\d+(?:\.\d+)?|\.\d+"#
    private static let metric = try! NSRegularExpression(pattern: "^(\(number))\\s*([a-z]+)?$")
    private static let metresAndCentimetres = try! NSRegularExpression(pattern: #"^(\d+)\s*m\s*(\d{2})$"#)
    private static let imperial = try! NSRegularExpression(pattern: "^(?:(\(number))\\s*(?:'|ft|feet|foot))?\\s*-?\\s*(?:(\(number))?\\s*(?:(\\d+)\\/(\\d+))?\\s*(?:\"|in|inch|inches))?$")
    private static let imperialMark = try! NSRegularExpression(pattern: #"['"]|ft|feet|foot|in"#)

    /// Metres. A bare number is read in `unit`.
    public static func parse(_ input: String, unit: LengthUnit = .m) throws -> Double {
        let text = input.trimmingCharacters(in: .whitespaces).lowercased()
            .replacingOccurrences(of: "′", with: "'").replacingOccurrences(of: "’", with: "'")
            .replacingOccurrences(of: "″", with: "\"").replacingOccurrences(of: "”", with: "\"")
        let fail = { (reason: String) in LengthError(input: input, reason: reason) }
        if text.isEmpty { throw fail("it is empty") }
        if text.contains(",") { throw fail("commas are ambiguous; use a dot for decimals and no thousands separators") }
        if text.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value > 0x7e }) { throw fail("it contains characters that are not part of a length") }

        let negative = text.hasPrefix("-")
        let body = negative ? String(text.dropFirst()).trimmingCharacters(in: .whitespaces) : text
        let sign: Double = negative ? -1 : 1

        if let match = groups(metric, body), match[2] == nil || metricWords[match[2]!] != nil {
            let u = match[2].flatMap { metricWords[$0] } ?? unit
            return tidy(sign * Double(match[1]!)! * u.metres)
        }
        if let match = groups(metresAndCentimetres, body) {
            return tidy(sign * (Double(match[1]!)! + Double(match[2]!)! / 100))
        }
        if !body.isEmpty, let match = groups(imperial, body), groups(imperialMark, body, anchored: false) != nil {
            if let den = match[4], Double(den) == 0 { throw fail("a fraction cannot divide by zero") }
            let feet = match[1].flatMap(Double.init) ?? 0
            let inches = match[2].flatMap(Double.init) ?? 0
            let fraction = match[3].flatMap(Double.init).map { $0 / Double(match[4]!)! } ?? 0
            return tidy(sign * (feet * 12 + inches + fraction) * LengthUnit.in.metres)
        }
        throw fail("the format is not one I recognise")
    }

    /// Clean up float noise such as 1.8000000000000003 (12 significant digits, as the studio does).
    static func tidy(_ value: Double) -> Double {
        guard value != 0, value.isFinite else { return value }
        let digits = 12 - Int((log10(abs(value))).rounded(.down)) - 1
        let factor = pow(10.0, Double(digits))
        return (value * factor).rounded() / factor
    }

    private static func groups(_ regex: NSRegularExpression, _ text: String, anchored: Bool = true) -> [String?]? {
        let range = NSRange(text.startIndex..., in: text)
        guard let m = regex.firstMatch(in: text, range: range) else { return nil }
        if anchored && m.range != range { return nil }
        return (0..<m.numberOfRanges).map { i in
            let r = m.range(at: i)
            return r.location == NSNotFound ? nil : Range(r, in: text).map { String(text[$0]) }
        }
    }
}
