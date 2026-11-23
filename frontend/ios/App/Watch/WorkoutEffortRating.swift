import SwiftUI

/// "How hard was it?" on the summary: the whole workout's effort, 1 to 10, as Apple Fitness asks
/// for it (Easy, Moderate, Hard, All out). Round chips outlined in their band's colour, the way
/// the rest screen rates a set (EffortChips), in two rows of five; the one picked is filled and
/// its word sits under them. A second tap on it takes the rating back. Taps, not the crown, which
/// scrolls the summary.
struct EffortRating: View {
    @Binding var value: Int?
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("How hard was it?")
                .font(.system(.footnote, design: .rounded).weight(.bold))
                .foregroundStyle(Theme.label2)
            ForEach([Array(1...5), Array(6...10)], id: \.self) { row in
                HStack(spacing: 4) {
                    ForEach(row, id: \.self) { chip($0) }
                }
            }
            if let v = value {
                Text(LocalizedStringKey(WorkoutEffort.word(v)))
                    .font(.system(.footnote, design: .rounded).weight(.semibold))
                    .foregroundStyle(EffortRating.color(v))
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.top, 2)
    }

    private func chip(_ n: Int) -> some View {
        let on = value == n
        let color = EffortRating.color(n)
        return Button {
            withAnimation(.snappy) { value = on ? nil : n }
        } label: {
            Text(verbatim: "\(n)")
                .font(.system(.body, design: .rounded).weight(.bold).monospacedDigit())
                .foregroundStyle(on && !dimmed ? Color.black : .white)
                .frame(maxWidth: .infinity, minHeight: 32, maxHeight: 32)
                .background(Capsule().fill(on && !dimmed ? color : Color.clear))
                .overlay(Capsule().strokeBorder(color, lineWidth: 1.5))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: "\(n), ") + Text(LocalizedStringKey(WorkoutEffort.word(n))))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// The band's colour, as on the phone's summary (WorkoutEffort.jsx): green, yellow, orange, red.
    static func color(_ v: Int) -> Color {
        switch v {
        case ...3: return Theme.green
        case 4...6: return Theme.yellow
        case 7...8: return Theme.orange
        default: return Theme.red
        }
    }
}
