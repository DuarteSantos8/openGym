import SwiftUI

struct EndedView: View {
    let averageBpm: Int?

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.largeTitle)
                .foregroundStyle(.tint)
            if let averageBpm {
                Text("\(averageBpm) BPM average")
                    .font(.headline)
            }
            Text("Saved to Health")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}
