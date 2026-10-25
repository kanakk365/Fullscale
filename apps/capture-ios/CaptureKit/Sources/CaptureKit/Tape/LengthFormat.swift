// Lengths and areas as people read them, in metres or in feet and inches. Lengths are shown
// to the centimetre or the inch: the scan isn't sure of more, and more digits would look
// surer than it is.
import Foundation

public enum LengthSystem: String, Codable, Sendable, CaseIterable {
    case metric, imperial
}

public enum LengthFormat {
    /// "4.71 m", or "15′ 5″".
    public static func length(_ metres: Double, _ system: LengthSystem) -> String {
        switch system {
        case .metric:
            return String(format: "%.2f m", metres)
        case .imperial:
            let inches = Int((metres / LengthUnit.in.metres).rounded())
            return "\(inches / 12)′ \(inches % 12)″"
        }
    }

    /// "11.6 m²", or "124 ft²".
    public static func area(_ squareMetres: Double, _ system: LengthSystem) -> String {
        switch system {
        case .metric:
            return String(format: "%.1f m²", squareMetres)
        case .imperial:
            let squareFeet = squareMetres / (LengthUnit.ft.metres * LengthUnit.ft.metres)
            return "\(Int(squareFeet.rounded())) ft²"
        }
    }

    /// How a tape value differs from the scan: "+1.2 cm", or "−0.5″".
    public static func difference(_ metres: Double, _ system: LengthSystem) -> String {
        let sign = metres >= 0 ? "+" : "−"
        switch system {
        case .metric:
            return "\(sign)\(String(format: "%.1f", abs(metres) * 100)) cm"
        case .imperial:
            return "\(sign)\(String(format: "%.1f", abs(metres) / LengthUnit.in.metres))″"
        }
    }

    /// The unit tape values are typed in by default.
    public static func tapeUnit(_ system: LengthSystem) -> LengthUnit {
        system == .metric ? .m : .ft
    }
}
