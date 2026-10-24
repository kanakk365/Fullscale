// Depth frames as stored in a capture: unsigned 16-bit millimetres, little-endian, packed
// with raw DEFLATE (no zlib header); 0 means "no value". Millimetres keep 1 mm steps at any
// distance, unlike 16-bit floats, whose steps grow to 2–4 mm past 2 m. Confidence is one
// byte per pixel (0 low, 1 medium, 2 high), packed the same way.
import Foundation

public enum DepthEncoding {
    /// The largest depth that fits: 65.534 m (65535 is left unused).
    static let maxMillimetres = 65_534

    /// Pack depths in metres. NaN, negative and out-of-range values become 0 ("no value").
    public static func encodeDepth(_ metres: [Float]) throws -> Data {
        var raw = Data(capacity: metres.count * 2)
        for value in metres {
            let mm: UInt16
            if value.isFinite, value > 0 {
                let rounded = (Double(value) * 1000).rounded()
                mm = rounded <= Double(maxMillimetres) ? UInt16(rounded) : 0
            } else {
                mm = 0
            }
            raw.append(UInt8(mm & 0xff))
            raw.append(UInt8(mm >> 8))
        }
        return try deflate(raw)
    }

    public static func decodeDepth(_ data: Data) throws -> [Float] {
        let raw = try inflate(data)
        return stride(from: 0, to: raw.count - 1, by: 2).map { i in
            Float(UInt16(raw[raw.startIndex + i]) | UInt16(raw[raw.startIndex + i + 1]) << 8) / 1000
        }
    }

    public static func encodeConfidence(_ levels: [UInt8]) throws -> Data {
        try deflate(Data(levels.map { min($0, 2) }))
    }

    public static func decodeConfidence(_ data: Data) throws -> [UInt8] {
        Array(try inflate(data))
    }

    // Apple's "zlib" algorithm writes raw DEFLATE (RFC 1951), which is what the format asks
    // for; Python reads it with zlib.decompress(data, -15) and browsers with
    // DecompressionStream("deflate-raw").
    static func deflate(_ data: Data) throws -> Data {
        try (data as NSData).compressed(using: .zlib) as Data
    }

    static func inflate(_ data: Data) throws -> Data {
        try (data as NSData).decompressed(using: .zlib) as Data
    }
}
