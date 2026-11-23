import SwiftUI

/// "How hard was it?" on the summary: the whole workout's effort, 1 to 10, as Apple Fitness asks
/// for it (Easy, Moderate, Hard, All out). One number, as the set page's boxes: before it is rated
/// it shows where it would start (the preset from the sets rated during the workout, else 5),
/// dimmed. A tap rates it there and hands it the Crown, a detent a step; a second tap lets the
/// Crown go back to the summary.
struct EffortRating: View {
    @Binding var value: Int?
    let preset: Int?
    var editing = false
    @FocusState private var focused: Bool
    @State private var index = 5
    @Environment(\.isLuminanceReduced) private var dimmed

    private var start: Int { preset ?? 5 }

    var body: some View {
        let shown = value ?? start
        let color = EffortRating.color(shown)
        VStack(alignment: .leading, spacing: 2) {
            NumberBox(value: "\(shown)", unit: nil, label: Text("How hard was it?"), tint: color, selected: focused)
                .opacity(value == nil && !focused ? 0.45 : 1)
                .focusable()
                .focusEffectDisabled()
                .focused($focused)
                .digitalCrownRotation(detent: $index, from: 1, through: 10, by: 1,
                                      sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
                .onTapGesture {
                    if focused { focused = false; return }
                    if value == nil { value = start }
                    index = value ?? start
                    focused = true
                }
                .onChange(of: index) { i in if focused, (1...10).contains(i), i != value { value = i } }
                .onAppear {
                    index = value ?? start
                    if editing { if value == nil { value = start }; focused = true }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("How hard was it?"))
                .accessibilityValue(value.map { Text(verbatim: "\($0), ") + Text(LocalizedStringKey(WorkoutEffort.word($0))) } ?? Text("None"))
                .accessibilityAdjustableAction { dir in
                    switch dir {
                    case .increment: value = WorkoutEffort.step(value ?? start - 1, by: 1)
                    case .decrement: value = WorkoutEffort.step(value ?? start + 1, by: -1)
                    @unknown default: break
                    }
                }
            if let v = value {
                Text(LocalizedStringKey(WorkoutEffort.word(v)))
                    .font(.system(.footnote, design: .rounded).weight(.semibold))
                    .foregroundStyle(color.opacity(dimmed ? 0.7 : 1))
                    .padding(.leading, 8)
            }
        }
        .padding(.top, 2)
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
