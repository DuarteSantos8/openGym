import SwiftUI

/// One vertical drum: a wheel picker in a dark rounded cell, shaded top and bottom so the rolling
/// values read as a cylinder. Tapping it gives it the Digital Crown.
struct DialView: View {
    let title: String
    let values: [Double]
    let decimals: Int
    @Binding var index: Int

    var body: some View {
        VStack(spacing: 2) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Picker(title, selection: $index) {
                ForEach(values.indices, id: \.self) { i in
                    Text(Self.format(values[i], decimals: decimals))
                        .font(.system(size: 22, weight: .semibold, design: .rounded).monospacedDigit())
                        .tag(i)
                }
            }
            .pickerStyle(.wheel)
            .labelsHidden()
            .frame(minHeight: 64)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(LinearGradient(colors: [Color(white: 0.08), Color(white: 0.2), Color(white: 0.08)],
                                         startPoint: .top, endPoint: .bottom))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .accessibilityElement(children: .contain)
    }

    static func format(_ value: Double, decimals: Int) -> String {
        String(format: "%.\(decimals)f", value)
    }
}

extension DialView {
    /// From `low` to `high` in `step`s, with `value` itself kept when it is off that grid.
    static func grid(low: Double, high: Double, step: Double, including value: Double) -> [Double] {
        let count = Int(((high - low) / step).rounded(.down))
        var values = (0...max(0, count)).map { low + Double($0) * step }
        if !values.contains(where: { abs($0 - value) < 0.001 }), value >= low, value <= high {
            values.append(value)
            values.sort()
        }
        return values
    }

    static func nearest(_ value: Double, in values: [Double]) -> Int {
        values.indices.min(by: { abs(values[$0] - value) < abs(values[$1] - value) }) ?? 0
    }
}
