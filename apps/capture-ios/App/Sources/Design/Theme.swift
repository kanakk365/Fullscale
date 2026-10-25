// The app's look: one brand colour, rounded cards, checklist chips, a progress ring, and the
// small taps of haptic feedback that mark a step done.
import CaptureKit
import SwiftUI
import UIKit

extension Color {
    /// Fullscale's colour: a deep teal that reads on camera pictures and in dark mode.
    static let brand = Color(red: 0.05, green: 0.62, blue: 0.53)
    static let card = Color(.secondarySystemGroupedBackground)
}

extension UIColor {
    static let brand = UIColor(red: 0.05, green: 0.62, blue: 0.53, alpha: 1)
}

struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(Color.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

extension View {
    func card() -> some View { modifier(CardStyle()) }
}

/// A ring that fills as the scan of a room goes on, with the share in the middle.
struct ProgressRing: View {
    let fraction: Double
    let complete: Bool
    var size: CGFloat = 54

    var body: some View {
        ZStack {
            Circle().stroke(.white.opacity(0.25), lineWidth: 6)
            Circle()
                .trim(from: 0, to: max(0.02, fraction))
                .stroke(complete ? Color.green : Color.brand, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 0.4), value: fraction)
            if complete {
                Image(systemName: "checkmark").font(.system(size: size * 0.36, weight: .bold)).foregroundStyle(.green)
            } else {
                Text("\(Int((fraction * 100).rounded()))%").font(.system(size: size * 0.26, weight: .semibold).monospacedDigit())
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel(complete ? "Room complete" : "Scan \(Int((fraction * 100).rounded())) percent done")
    }
}

/// One line of the scan checklist: walls, floor, ceiling or photos.
struct ChecklistChip: View {
    let item: ScanProgress.Item
    let photos: Int

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).foregroundStyle(tint)
            Text(label).font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.black.opacity(0.35), in: Capsule())
        .foregroundStyle(.white)
        .animation(.easeOut, value: item.state)
    }

    private var label: String {
        switch item.topic {
        case .walls: "Walls"
        case .floor: "Floor"
        case .ceiling: "Ceiling"
        case .photos: "Photos \(photos)"
        }
    }

    private var symbol: String {
        switch item.state {
        case .done: "checkmark.circle.fill"
        case .partly: "circle.lefthalf.filled"
        case .todo: "circle"
        }
    }

    private var tint: Color {
        switch item.state {
        case .done: .green
        case .partly: .yellow
        case .todo: .white.opacity(0.7)
        }
    }
}

/// A small label with a value, as on the room screens: "Floor area  11.6 m²".
struct Stat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

enum Haptics {
    @MainActor static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    @MainActor static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    @MainActor static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
}

/// An icon for a room from its name: "Bedroom" gets a bed.
enum RoomIcon {
    static func symbol(for name: String) -> String {
        let n = name.lowercased()
        let table: [(String, String)] = [
            ("bed", "bed.double"), ("living", "sofa"), ("lounge", "sofa"), ("kitchen", "fork.knife"),
            ("dining", "fork.knife"), ("bath", "shower"), ("toilet", "toilet"), ("office", "desktopcomputer"),
            ("study", "books.vertical"), ("hall", "door.left.hand.open"), ("corridor", "door.left.hand.open"),
            ("balcony", "sun.max"), ("garage", "car"), ("store", "shippingbox"), ("meeting", "person.3"),
            ("shop", "bag"), ("counter", "cart"), ("reception", "person.crop.rectangle"), ("fitting", "tshirt"),
        ]
        return table.first { n.contains($0.0) }?.1 ?? "square.split.bottomrightquarter"
    }

    static func symbol(for kind: Library.Kind) -> String {
        switch kind {
        case .home: "house.fill"
        case .office: "building.2.fill"
        case .shop: "storefront.fill"
        case .other: "square.grid.2x2.fill"
        }
    }
}
