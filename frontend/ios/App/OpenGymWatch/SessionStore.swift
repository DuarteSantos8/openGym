import Foundation
import os

/// Everything the watch screens show, and the one place that turns the phone's messages into
/// workout-session calls. Commands run one after another, so an end that arrives while its start
/// is still being set up waits for it instead of finding nothing to end.
@MainActor
final class SessionStore: ObservableObject {

    enum Phase: Equatable {
        case idle
        case starting
        case running(workoutId: String, name: String, since: Date)
        case ending
        case ended(averageBpm: Int?)
        case failed(String)
    }

    // A start this old is a transfer that waited for the app for hours: that workout is long over.
    private static let staleStart: TimeInterval = 12 * 3600
    // The phone writes the workout itself once it stops waiting for the watch (lib/watch-link.js);
    // an end older than that is discarded here so Health does not get it twice.
    static let lateEnd: TimeInterval = 10 * 60
    private static let endedShown: Duration = .seconds(5)

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var bpm: Int?
    @Published var restEndsAt: Date?
    @Published var restTotal = 0
    @Published var restPaused = false
    @Published var restLeftWhenPaused = 0
    @Published private(set) var needsHealthAccess = false

    let link: ConnectivityManager
    var restAppliedAt = Date.distantPast
    var restHaptics: Task<Void, Never>?

    private let workouts: WorkoutSessionManager
    private let log = Logger(subsystem: "ch.duartesantos.opengym.watchkitapp", category: "Store")
    private var queue: Task<Void, Never>?
    private var endedIds: [String] = []
    private var backToIdle: Task<Void, Never>?
    private var launched = false

    init(workouts: WorkoutSessionManager, link: ConnectivityManager) {
        self.workouts = workouts
        self.link = link
    }

    convenience init() {
        self.init(workouts: WorkoutSessionManager(), link: ConnectivityManager())
    }

    func launch() {
        guard !launched else { return }
        launched = true
        workouts.onHeartRate = { [weak self] bpm in self?.heartRate(bpm) }
        workouts.onFailure = { [weak self] message in self?.sessionFailed(message) }
        link.onMessage = { [weak self] message in self?.enqueue(message) }
        link.activate()
        needsHealthAccess = workouts.healthAvailable && workouts.needsAuthorization
        enqueue { store in await store.recover() }
    }

    func requestHealthAccess() async {
        do {
            try await workouts.requestAuthorization()
        } catch {
            log.error("Health access: \(error.localizedDescription, privacy: .public)")
        }
        needsHealthAccess = workouts.needsAuthorization
    }

    // MARK: - Commands, one at a time

    private func enqueue(_ message: PhoneMessage) {
        if case let .rest(state, at) = message {
            applyRest(state, at: at)
            return
        }
        enqueue { store in await store.run(message) }
    }

    private func enqueue(_ work: @escaping @MainActor (SessionStore) async -> Void) {
        let previous = queue
        queue = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            await work(self)
        }
    }

    private func run(_ message: PhoneMessage) async {
        switch message {
        case let .start(id, name, startedAt):
            await start(id: id, name: name, startedAt: startedAt)
        case let .end(id, discard, endedAt):
            await end(id: id, discard: discard, endedAt: endedAt)
        case .rest:
            break
        }
    }

    private func recover() async {
        guard let active = await workouts.recover() else { return }
        phase = .running(workoutId: active.id, name: active.name, since: active.since)
        link.sendState("running", id: active.id)
    }

    private func start(id: String, name: String, startedAt: Date) async {
        if let current = workouts.active {
            // The same start again (a message and its transfer both arrived): say so once more.
            if current.id == id {
                link.sendState("running", id: id)
                return
            }
            // A newer workout while one runs means its end never came: close that one first.
            guard startedAt > current.since else { return }
            await end(id: current.id, discard: false, endedAt: Date())
        }
        guard !endedIds.contains(id), Date().timeIntervalSince(startedAt) < Self.staleStart else { return }
        backToIdle?.cancel()
        phase = .starting
        do {
            if workouts.needsAuthorization { try await workouts.requestAuthorization() }
            try await workouts.start(id: id, name: name, startedAt: startedAt)
            needsHealthAccess = false
            bpm = nil
            phase = .running(workoutId: id, name: name, since: min(startedAt, Date()))
            link.sendState("running", id: id)
        } catch {
            let message = error.localizedDescription
            log.error("Start failed: \(message, privacy: .public)")
            phase = .failed(message)
            link.sendState("failed", id: id, error: message)
        }
    }

    private func end(id: String, discard: Bool, endedAt: Date) async {
        remember(id)
        guard workouts.active?.id == id else {
            // Nothing running for it here: the phone keeps the workout to itself.
            link.sendState("failed", id: id, error: "not running")
            return
        }
        let late = Date().timeIntervalSince(endedAt) > Self.lateEnd
        phase = .ending
        clearRest()
        do {
            let outcome = try await workouts.end(discard: discard || late, at: min(endedAt, Date()))
            switch outcome {
            case let .saved(average):
                phase = .ended(averageBpm: average)
                link.sendState("ended", id: id)
                scheduleIdle()
            case .discarded:
                phase = .idle
                link.sendState("failed", id: id, error: "discarded")
            }
        } catch {
            let message = error.localizedDescription
            log.error("End failed: \(message, privacy: .public)")
            phase = .failed(message)
            link.sendState("failed", id: id, error: message)
        }
        bpm = nil
    }

    private func remember(_ id: String) {
        endedIds = Array((endedIds + [id]).suffix(20))
    }

    private func scheduleIdle() {
        backToIdle?.cancel()
        backToIdle = Task { [weak self] in
            try? await Task.sleep(for: Self.endedShown)
            guard !Task.isCancelled, let self, case .ended = self.phase else { return }
            self.phase = .idle
        }
    }

    // MARK: - From the session

    private func heartRate(_ value: Int) {
        guard case .running = phase else { return }
        bpm = value
        link.sendHeartRate(value)
    }

    private func sessionFailed(_ message: String) {
        guard case let .running(id, _, _) = phase else { return }
        phase = .failed(message)
        bpm = nil
        link.sendState("failed", id: id, error: message)
    }
}
