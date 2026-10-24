// After each room: measure two to five things with a tape and type the values. The app shows
// how each compares with the scan, but never changes the scan; the computer decides what to
// do with the checks.
import CaptureKit
import SwiftUI

struct TapeCheckView: View {
    @Environment(Recorder.self) private var recorder
    @Environment(\.dismiss) private var dismiss
    @State private var element: ScannedElement?
    @State private var typed = ""
    @State private var unit: LengthUnit = .m
    @State private var heldOut = false
    @State private var results: [(label: String, band: TapeBand?)] = []
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("What did you measure?") {
                    Picker("Element", selection: $element) {
                        Text("Choose…").tag(ScannedElement?.none)
                        ForEach(recorder.scanned) { e in
                            Text("\(e.label) (scan: \(String(format: "%.2f", e.metres)) m)").tag(ScannedElement?.some(e))
                        }
                    }
                    HStack {
                        TextField("Tape value, e.g. 3.41 or 11' 2\"", text: $typed)
                            .keyboardType(.numbersAndPunctuation)
                            .autocorrectionDisabled()
                        Picker("Unit", selection: $unit) {
                            ForEach([LengthUnit.m, .cm, .ft, .in], id: \.self) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.menu)
                    }
                    Toggle("Keep back to test the result", isOn: $heldOut)
                    if let problem { Text(problem).foregroundStyle(.red).font(.caption) }
                    Button("Add check", action: add).disabled(element == nil || typed.isEmpty)
                }
                if !results.isEmpty {
                    Section("Checks") {
                        ForEach(Array(results.enumerated()), id: \.offset) { _, r in
                            HStack {
                                Text(r.label)
                                Spacer()
                                Text(r.band?.rawValue ?? "saved").foregroundStyle(colour(r.band))
                            }
                        }
                    }
                }
            }
            .navigationTitle("Tape checks")
            .toolbar {
                Button("Done") {
                    recorder.doneChecking()
                    dismiss()
                }
            }
        }
    }

    private func add() {
        guard let element else { return }
        do {
            let band = try recorder.addTapeCheck(kind: element.kind, element: element.id, scanM: element.metres, typed: typed, unit: unit, heldOut: heldOut)
            results.append((element.label, band))
            typed = ""
            problem = nil
        } catch {
            problem = String(describing: error)
        }
    }

    private func colour(_ band: TapeBand?) -> Color {
        switch band {
        case .green: .green
        case .amber: .orange
        case .red: .red
        case nil: .secondary
        }
    }
}
