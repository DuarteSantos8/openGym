import Foundation
import HealthKit
import os

/// The wrist side of a workout: one HKWorkoutSession with its live builder, so Health samples heart
/// rate at workout rate and keeps one HKWorkout with that heart rate attached. The phone owns the
/// workout itself; this only follows its start and end.
@MainActor
final class WorkoutSessionManager: NSObject {

    enum EndOutcome: Equatable, Sendable {
        /// In Health now, saved here or already there from the phone.
        case saved(averageBpm: Int?)
        case discarded
    }

    struct Active: Codable, Equatable, Sendable {
        let id: String
        let name: String
        let since: Date
    }

    private static let activeKey = "opengym.watch.active"
    private static let titleKey = "ch.duartesantos.opengym.title"

    var onHeartRate: ((Int) -> Void)?
    var onFailure: ((String) -> Void)?

    private let store = HKHealthStore()
    private let log = Logger(subsystem: "ch.duartesantos.opengym.watchkitapp", category: "Workout")
    private let heartRate = HKQuantityType(.heartRate)
    private let energy = HKQuantityType(.activeEnergyBurned)
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    /// The workout this watch is following, kept across a relaunch for recovery.
    private(set) var active: Active? {
        didSet { Self.persist(active) }
    }

    override init() {
        active = Self.restore()
        super.init()
    }

    var healthAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    /// True until the user has answered the workout-sharing request at least once.
    var needsAuthorization: Bool {
        store.authorizationStatus(for: HKObjectType.workoutType()) == .notDetermined
    }

    func requestAuthorization() async throws {
        let share: Set<HKSampleType> = [HKObjectType.workoutType(), energy]
        // Workouts are read too: before saving, a workout the phone already wrote under the same
        // id is looked for, so a late end never adds a second one.
        let read: Set<HKObjectType> = [heartRate, energy, HKObjectType.workoutType()]
        try await store.requestAuthorization(toShare: share, read: read)
    }

    func start(id: String, name: String, startedAt: Date) async throws {
        guard session == nil else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor
        let newSession = try HKWorkoutSession(healthStore: store, configuration: config)
        let newBuilder = newSession.associatedWorkoutBuilder()
        newBuilder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
        newSession.delegate = self
        newBuilder.delegate = self
        // The phone's clock started first; a start in the future is clock drift between the two.
        let start = min(startedAt, Date())
        session = newSession
        builder = newBuilder
        active = Active(id: id, name: name, since: start)
        newSession.startActivity(with: start)
        do {
            try await newBuilder.beginCollection(at: start)
            log.info("Workout \(id, privacy: .public) started")
        } catch {
            reset()
            throw error
        }
    }

    /// Ends the session at the phone's end time and saves the workout, or throws it away.
    func end(discard: Bool, at end: Date) async throws -> EndOutcome {
        guard let session, let builder, let active else {
            reset()
            return .discarded
        }
        defer { reset() }
        session.end()
        try await builder.endCollection(at: max(end, active.since))
        let average = builder.statistics(for: heartRate)?.averageQuantity()
            .map { Int($0.doubleValue(for: Self.bpm).rounded()) }
        let externalId = "opengym-w-" + active.id
        if discard {
            builder.discardWorkout()
            log.info("Workout \(active.id, privacy: .public) discarded")
            return .discarded
        }
        if try await savedElsewhere(externalId) {
            builder.discardWorkout()
            log.info("Workout \(active.id, privacy: .public) already in Health, not saved again")
            return .saved(averageBpm: average)
        }
        var metadata: [String: Any] = [
            HKMetadataKeyExternalUUID: externalId,
            HKMetadataKeyWorkoutBrandName: "openGym",
        ]
        if !active.name.isEmpty { metadata[Self.titleKey] = active.name }
        try await builder.addMetadata(metadata)
        _ = try await builder.finishWorkout()
        log.info("Workout \(active.id, privacy: .public) saved")
        return .saved(averageBpm: average)
    }

    /// Picks the session back up after the app was killed or the watch restarted mid-workout.
    func recover() async -> Active? {
        guard session == nil, let active else { return nil }
        do {
            guard let recovered = try await store.recoverActiveWorkoutSession() else {
                self.active = nil
                return nil
            }
            let recoveredBuilder = recovered.associatedWorkoutBuilder()
            recovered.delegate = self
            recoveredBuilder.delegate = self
            session = recovered
            builder = recoveredBuilder
            log.info("Workout \(active.id, privacy: .public) recovered")
            return active
        } catch {
            log.error("Recovery failed: \(error.localizedDescription, privacy: .public)")
            self.active = nil
            return nil
        }
    }

    private func reset() {
        session = nil
        builder = nil
        active = nil
    }

    private func savedElsewhere(_ externalId: String) async throws -> Bool {
        let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeyExternalUUID,
                                                    allowedValues: [externalId])
        let descriptor = HKSampleQueryDescriptor(predicates: [.workout(predicate)], sortDescriptors: [], limit: 1)
        return try await !descriptor.result(for: store).isEmpty
    }

    nonisolated static var bpm: HKUnit { HKUnit.count().unitDivided(by: .minute()) }

    private static func persist(_ active: Active?) {
        let data = active.flatMap { try? JSONEncoder().encode($0) }
        UserDefaults.standard.set(data, forKey: activeKey)
    }

    private static func restore() -> Active? {
        guard let data = UserDefaults.standard.data(forKey: activeKey) else { return nil }
        return try? JSONDecoder().decode(Active.self, from: data)
    }
}

extension WorkoutSessionManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState, date: Date) {}

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in
            self.log.error("Session failed: \(message, privacy: .public)")
            self.reset()
            self.onFailure?(message)
        }
    }
}

extension WorkoutSessionManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let type = HKQuantityType(.heartRate)
        guard collectedTypes.contains(type),
              let quantity = workoutBuilder.statistics(for: type)?.mostRecentQuantity() else { return }
        let bpm = Int(quantity.doubleValue(for: Self.bpm).rounded())
        Task { @MainActor in self.onHeartRate?(bpm) }
    }
}
