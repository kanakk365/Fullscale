// Tape checks for the room just scanned: pick a wall, door or window the scanner found, type
// what the tape says, and see at once how close the scan was. The app never changes the scan;
// the computer decides what to do with the checks.
import CaptureKit
import SwiftUI

struct TapeCheckView: View {
    @Environment(Recorder.self) private var recorder
    @Environment(LibraryStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var measuring: ScannedElement?
    @State private var results: [String: (tapeM: Double, band: TapeBand?)] = [:]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(recorder.scanned) { element in
                        Button { measuring = element } label: { row(element) }
                            .tint(.primary)
                    }
                } header: {
                    Text("Tap what you measured")
                } footer: {
                    Text("Measure along the wall at waist height, from corner to corner. Green means the scan is within 1% and 2 cm of your tape.")
                }
            }
            .navigationTitle("Tape checks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sheet(item: $measuring) { element in
                TapeEntry(element: element) { tapeM, band in results[element.id] = (tapeM, band) }
                    .environment(recorder)
                    .presentationDetents([.height(300)])
            }
        }
    }

    private func row(_ element: ScannedElement) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(element.label).font(.body.weight(.medium))
                Text("Scan: \(LengthFormat.length(element.metres, store.units))").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            Spacer()
            if let result = results[element.id] {
                Text(LengthFormat.difference(element.metres - result.tapeM, store.units))
                    .font(.caption.weight(.semibold)).monospacedDigit()
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background((result.band?.colour ?? .secondary).opacity(0.18), in: Capsule())
                    .foregroundStyle(result.band?.colour ?? .secondary)
            } else {
                Image(systemName: "ruler").foregroundStyle(Color.brand)
            }
        }
    }
}

private struct TapeEntry: View {
    @Environment(Recorder.self) private var recorder
    @Environment(LibraryStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let element: ScannedElement
    let saved: (Double, TapeBand?) -> Void
    @State private var typed = ""
    @State private var unit = LengthUnit.m
    @State private var problem: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(element.label).font(.headline)
            Text("The scan says \(LengthFormat.length(element.metres, store.units)). What does your tape say?").font(.subheadline).foregroundStyle(.secondary)
            HStack {
                TextField(unit == .ft ? "11' 2\"" : "3.41", text: $typed)
                    .font(.title2.monospacedDigit())
                    .keyboardType(.numbersAndPunctuation)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(save)
                Picker("Unit", selection: $unit) {
                    ForEach([LengthUnit.m, .cm, .ft, .in], id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(width: 180)
            }
            .padding(12)
            .background(Color.card, in: RoundedRectangle(cornerRadius: 12))
            if let problem { Text(problem).font(.caption).foregroundStyle(.red) }
            Button("Save", action: save).buttonStyle(.borderedProminent).controlSize(.large).frame(maxWidth: .infinity).disabled(typed.isEmpty)
        }
        .padding(20)
        .onAppear {
            unit = LengthFormat.tapeUnit(store.units)
            focused = true
        }
    }

    private func save() {
        do {
            let band = try recorder.addTapeCheck(kind: element.kind, element: element.id, scanM: element.metres, typed: typed, unit: unit, heldOut: false)
            saved(try LengthParser.parse(typed, unit: unit), band)
            Haptics.tap()
            dismiss()
        } catch {
            problem = String(describing: error)
        }
    }
}
