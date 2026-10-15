import Foundation

let start = 1_791_369_600_000.0
let end = start + 3_600_000
let row: [String: Any] = ["id": "selected", "start": start, "end": end]
let target = HealthWorkoutDeletion(row)!
let at = Date(timeIntervalSince1970: start / 1000)
let until = Date(timeIntervalSince1970: end / 1000)
let app = "test.opengym"
func matches(_ source: String = "test.opengym", _ id: String? = "opengym-workout-selected", _ begins: Date? = nil, _ ends: Date? = nil) -> Bool {
    target.matches(source: source, appSource: app, externalID: id, start: begins ?? at, end: ends ?? until)
}
precondition(matches(), "the selected openGym workout must match")
precondition(!matches("com.apple.Health"), "never delete Apple's own workout")
precondition(!matches("com.example.other"), "never delete a third-party workout")
precondition(!matches(app, "opengym-workout-other"), "another openGym session must survive")
precondition(!matches(app, "opengym-workout-selected-extra"), "identifier prefixes are not exact matches")
precondition(!matches(app, nil), "unidentified workouts must survive")
precondition(!matches(app, "opengym-workout-selected", at.addingTimeInterval(1)), "same id, different start must survive")
precondition(!matches(app, "opengym-workout-selected", nil, until.addingTimeInterval(1)), "same id, different end must survive")
precondition(HealthWorkoutDeletion(["id": "", "start": start, "end": end]) == nil)
precondition(HealthWorkoutDeletion(["id": "x", "start": Double.nan, "end": end]) == nil)
precondition(HealthWorkoutDeletion(["id": "x", "start": start, "end": start]) == nil)
precondition(HealthWorkoutDeletion(["id": "x", "start": start, "end": Double.infinity]) == nil)
print("12 native workout deletion safety checks passed")
