// After a room: what was scanned (a model to turn, the main sizes), a few tape checks to make
// the model exact, and what to do next: another room, more of this one, or done.
import CaptureKit
import SwiftUI

struct RoomReviewView: View {
    @Environment(LibraryStore.self) private var store
    let finished: FinishedRoom
    let recorder: Recorder
    let scanAnother: () -> Void
    let scanMore: () -> Void
    let done: () -> Void
    @State private var checking = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 40)
            ScrollView {
                VStack(spacing: 16) {
                    header
                    RoomModelView(room: finished.layout, interactive: true)
                        .frame(height: 240)
                        .background(Color.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    sizes
                    tapeCard
                }
                .padding(20)
            }
            actions
        }
        .background(Color(.systemGroupedBackground), in: UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28))
        .ignoresSafeArea(edges: .bottom)
        .sheet(isPresented: $checking) { TapeCheckView().environment(recorder) }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill").font(.title).foregroundStyle(.green)
            VStack(alignment: .leading) {
                Text("\(finished.name) saved").font(.title2.weight(.bold))
                Text("\(finished.summary.photos) photos · \(finished.summary.walls) walls").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var sizes: some View {
        let s = finished.summary
        return HStack {
            Stat(label: "Floor area", value: s.floorAreaM2.map { LengthFormat.area($0, store.units) } ?? "–")
            Stat(label: "Size", value: s.lengthM.flatMap { l in s.widthM.map { "\(LengthFormat.length(l, store.units)) × \(LengthFormat.length($0, store.units))" } } ?? "–")
            Stat(label: "Ceiling", value: s.heightM.map { LengthFormat.length($0, store.units) } ?? "–")
        }
        .card()
    }

    private var tapeCard: some View {
        Button { checking = true } label: {
            HStack(spacing: 14) {
                Image(systemName: "ruler").font(.title2).foregroundStyle(Color.brand)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Check with a tape").font(.headline)
                    Text("Measure two or three walls and a door. Your model gets exact, and you see how close the scan was.")
                        .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .card()
        }
        .buttonStyle(.plain)
    }

    private var actions: some View {
        VStack(spacing: 10) {
            Button(action: scanAnother) {
                Label("Scan another room", systemImage: "viewfinder").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            HStack {
                Button("Scan more of \(finished.name)", action: scanMore).buttonStyle(.bordered)
                Spacer()
                Button("Done", action: done).buttonStyle(.bordered).fontWeight(.semibold)
            }
        }
        .padding(20)
        .padding(.bottom, 12)
        .background(.bar)
    }
}
