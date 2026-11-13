import SwiftUI
import WatchKit

/*
 * The start screen: "Today" beside the clock, today's routine with how big it is and one full-width
 * Start, the other routines as grey rows under it. Nothing ticks here (no timers, no animation), so
 * the watch sleeps while it waits. A long press shows what arrived from the phone.
 */
struct HomeView: View {
    @EnvironmentObject var store: SessionStore
    @State private var debug = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(store.ready?.today != nil ? Text("Today") : Text(verbatim: "openGym"))
                .toolbar { ToolbarItem(placement: .topBarLeading) { PhoneMark().environmentObject(store) } }
        }
        // Hidden: a long press shows what arrived from the phone (animations, sync, heart rate).
        .onLongPressGesture(minimumDuration: 2) { debug = true }
        .sheet(isPresented: $debug) { DebugView() }
    }

    @ViewBuilder private var content: some View {
        if let ready = store.ready, ready.today != nil || !ready.others.isEmpty {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if let today = ready.today { TodayCard(session: today) }
                    if !ready.others.isEmpty {
                        VStack(spacing: 4) {
                            ForEach(Array(ready.others.enumerated()), id: \.offset) { pair in
                                Button { store.start(pair.element) } label: {
                                    HStack(spacing: 6) {
                                        Text(verbatim: pair.element.name).lineLimit(2).minimumScaleFactor(0.8)
                                        Spacer(minLength: 4)
                                        Image(systemName: "play.fill").font(.caption2).foregroundStyle(Theme.label2)
                                    }
                                }
                                .buttonStyle(RowButtonStyle())
                            }
                        }
                        .padding(.top, ready.today == nil ? 0 : 6)
                    }
                    // A workout finished here with the phone away: its sets are still on their way.
                    SyncLine(showSynced: false).padding(.top, 4)
                    VersionLine()
                }
                .padding(.horizontal, 2)
            }
        } else {
            // Nothing from the phone yet (it sends only while openGym runs there): say so, rather
            // than a "no workout" that reads as if the two were in touch.
            let fresh = !store.heardFromPhone && store.ready == nil
            ScrollView {
                VStack(spacing: 10) {
                    LogoMark()
                    Text(fresh ? LocalizedStringKey("Not synced yet") : LocalizedStringKey("No workout running"))
                        .font(.system(.headline, design: .rounded))
                        .multilineTextAlignment(.center)
                    Text(fresh ? LocalizedStringKey("Open openGym on your iPhone once and your routines show up here.")
                         : LocalizedStringKey("Start one on your iPhone and it shows up here."))
                        .font(.footnote)
                        .foregroundStyle(Theme.label2)
                        .multilineTextAlignment(.center)
                    VersionLine()
                }
                .padding(.horizontal, 6)
            }
        }
    }
}

/// Today's routine: its name big, how big it is, and Start.
/// The phone, beside the clock on the start screen, always: a quiet grey iPhone while it is in reach,
/// an amber crossed-out one and "Phone away" when not (shape and words, never colour alone). Nothing
/// moves, so the watch still sleeps here. The workout's own sign is SyncPill, shown only when sets wait.
struct PhoneMark: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        let away = !store.reachable
        HStack(spacing: 3) {
            Image(systemName: away ? "iphone.slash" : "iphone").font(.system(size: 13, weight: .semibold))
            if away { Text("Phone away").font(.system(.caption2, design: .rounded).weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8) }
        }
        .foregroundStyle(away ? Theme.orange : Theme.label2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(away ? Text("iPhone out of reach") : Text("iPhone in reach"))
    }
}

struct TodayCard: View {
    @EnvironmentObject var store: SessionStore
    let session: ReadySession

    var body: some View {
        let size = Plan.size(session.entries)
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: session.name)
                .font(.system(.title3, design: .rounded).weight(.bold))
                .lineLimit(2)
                .minimumScaleFactor(0.7)
                .fixedSize(horizontal: false, vertical: true)
            if size.exercises > 0 {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    stat(size.exercises, Text("Exercises"))
                    stat(size.sets, Text("Sets"))
                }
            }
            Button { store.start(session) } label: {
                Label { Text("Start workout") } icon: { Image(systemName: "play.fill") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.top, 2)
        }
    }

    private func stat(_ n: Int, _ label: Text) -> some View {
        VStack(alignment: .leading, spacing: -2) {
            Text(verbatim: "\(n)").font(.system(.title3, design: .rounded).weight(.semibold).monospacedDigit())
            label.font(.caption2).foregroundStyle(Theme.label2).lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The logo mark in brand green (not the accent: the logo is not the user's colour), for a screen
/// with nothing else to show.
struct LogoMark: View {
    var body: some View {
        OpenGymLogo()
            .fill(OpenGymLogo.green)
            .frame(width: 60, height: 30)
            .accessibilityHidden(true)
    }
}

/// "openGym 1.4.5 (49)", small at the end of the start screen: which build is on the watch.
struct VersionLine: View {
    var body: some View {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? ""
        let build = info?["CFBundleVersion"] as? String ?? ""
        Text(verbatim: "openGym \(version)" + (build.isEmpty ? "" : " (\(build))"))
            .font(.system(size: 10, design: .rounded))
            .foregroundStyle(Theme.label3)
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
            .accessibilityHidden(true)
    }
}
