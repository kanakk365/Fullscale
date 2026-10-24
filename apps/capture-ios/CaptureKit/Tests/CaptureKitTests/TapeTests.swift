import Foundation
import Testing
@testable import CaptureKit

/// The shared cases in fixtures/tape-checks.json, which the studio and the Android app test against too.
struct TapeFixture: Decodable {
    struct Length: Decodable, Sendable, CustomTestStringConvertible {
        let input: String
        let unit: String
        let metres: Double?
        let refused: Bool?
        var testDescription: String { "\"\(input)\" (\(unit))" }
    }

    struct Bands: Decodable {
        struct Case: Decodable, Sendable { let scanM: Double; let tapeM: Double; let band: String }
        let cases: [Case]
    }

    let lengths: [Length]
    let bands: Bands

    static let shared: TapeFixture = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../../fixtures/tape-checks.json").standardized
        return try! JSONDecoder().decode(TapeFixture.self, from: Data(contentsOf: url))
    }()
}

@Suite("Tape checks")
struct TapeTests {
    @Test("reads lengths exactly as the studio does", arguments: TapeFixture.shared.lengths)
    func readsLengths(_ c: TapeFixture.Length) throws {
        let unit = LengthUnit(rawValue: c.unit)!
        if c.refused == true {
            #expect(throws: LengthError.self) { try LengthParser.parse(c.input, unit: unit) }
        } else {
            #expect(try LengthParser.parse(c.input, unit: unit) == c.metres)
        }
    }

    @Test("grades a check against the scan as the studio does")
    func grades() {
        for c in TapeFixture.shared.bands.cases {
            #expect(TapeGrading.band(scanM: c.scanM, tapeM: c.tapeM).rawValue == c.band, "scan \(c.scanM) against tape \(c.tapeM)")
        }
    }

    @Test("questions unlikely tape values and big differences")
    func plausibility() {
        #expect(TapeGrading.isPlausible(tapeM: 0.1) == false)
        #expect(TapeGrading.isPlausible(tapeM: 3.4))
        #expect(TapeGrading.needsConfirmation(scanM: 3.0, tapeM: 3.4))
        #expect(TapeGrading.needsConfirmation(scanM: 3.38, tapeM: 3.4) == false)
    }
}
