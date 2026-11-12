import SwiftUI
import UIKit

/**
 * For CI only (.github/workflows/ios.yml): started with -OpenGymWidgetPreview, the app draws the
 * widgets and the Live Activity (WidgetViews.swift, the same views the widget extension shows)
 * with made-up data into PNG files in Documents/widget-preview, light and dark, and writes
 * done.txt when it is through. Nobody without a Mac can put a widget on a simulator's Home
 * Screen, so this is how a change to them is seen. Never runs otherwise: nothing but the CI step
 * passes the argument.
 */
enum WidgetPreview {
    static let argument = "-OpenGymWidgetPreview"

    static func runIfAsked() {
        guard ProcessInfo.processInfo.arguments.contains(argument) else { return }
        if #available(iOS 17.0, *) {
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                render()
            }
        }
    }

    @available(iOS 17.0, *)
    private static func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T? {
        try? JSONDecoder().decode(type, from: Data(json.utf8))
    }

    @available(iOS 17.0, *)
    private static func snapshot(today: String, active: String = "null") -> WidgetSnapshot? {
        decode(WidgetSnapshot.self, """
        {"v":1,"today":"\(today)","weekFrom":"\(today)","weekUntil":"9999-12-31","unit":"kg","accent":"#a3e635","ink":"#0c0e12",
         "days":[{"iso":"\(today)","weekday":"Wednesday","name":"Push Day","count":5,"done":false,"ids":["r1"],"exercises":[
           {"name":"Barbell Bench Press","line":"4 × 6 · 80 kg"},{"name":"Overhead Press","line":"3 × 8 · 45 kg"},
           {"name":"Incline Dumbbell Press","line":"3 × 10 · 26 kg"},{"name":"Lateral Raise","line":"3 × 15 · 10 kg"},
           {"name":"Triceps Pushdown","line":"3 × 12 · 30 kg"}]},
          {"iso":"9999-12-30","weekday":"Friday","name":"Leg Day","count":4}],
         "week":{"done":2,"planned":4},"streak":7,"lastPR":{"name":"Barbell Squat","value":"120 kg","d":"\(today)"},
         "streakInfo":{"current":7,"best":12,"freezes":1,"weekDone":true,"next":12,"line":"7 week streak","bestLine":"Best: 12"},
         "weight":{"current":82.4,"goal":78,"toGo":4.4,"unit":"kg","trend":[84.1,83.8,83.9,83.2,82.9,82.7,82.4],"currentText":"82.4 kg","goalText":"78 kg","line":"4.4 kg to go"},
         "records":{"month":3,"monthLine":"3 PRs this month","last":{"name":"Barbell Squat","value":"120 kg","d":"\(today)"}},
         "volume":{"now":12400,"prev":10300,"unit":"kg","pct":20,"nowText":"12.4k kg","prevText":"10.3k kg","line":"+20% vs last week"},"level":null,
         "challenges":{"month":"9999-12","done":1,"total":3,"line":"1 of 3 done","next":"14 workouts this month · 9 / 14"},
         "active":\(active),
         "labels":{"today":"Today","restDay":"Rest day","upNext":"Up next","thisWeek":"This week","weekStreak":"Week streak",
           "streak":"7 week streak","lastPR":"Last PR","done":"Done","running":"Workout running",
           "weightGoal":"Weight goal","nextWorkout":"Next workout","records":"Records","volume":"Volume","challenges":"Challenges","nothingPlanned":"Nothing planned","noWeighIn":"No weigh-ins yet"}}
        """)
    }

    @available(iOS 17.0, *)
    private static func live(rest: Bool, over: Bool = false) -> (WorkoutActivityAttributes, WorkoutActivityAttributes.ContentState)? {
        let end = (Date().timeIntervalSince1970 + (over ? -2 : 75)) * 1000
        guard let a = decode(WorkoutActivityAttributes.self, """
        {"v":2,"wid":"preview","start":null,"accent":"#a3e635","ink":"#0c0e12",
         "labels":{"done":"Log set","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!",
           "nextExercise":"Next exercise","skipRest":"Skip rest","openApp":"Open openGym for the next set"}}
        """), let s = decode(WorkoutActivityAttributes.ContentState.self, """
        {"name":"Push Day","cur":{"exId":"0025","entryIdx":0,"setIdx":2,"exName":"Barbell Bench Press","setLine":"Set 3 of 4",
          "target":"80 kg × 6","restAfter":120,"unit":0},"ahead":[],"restEndsAt":\(rest ? String(end) : "null"),"restLeft":null,
          "restTotal":\(rest ? "120" : "null"),"done":6,"total":17,
          "unitStarts":[{"exId":"0043","entryIdx":1,"setIdx":0,"exName":"Overhead Press","setLine":"Set 1 of 3","target":"40 kg × 8","restAfter":90,"unit":1}]}
        """) else { return nil }
        return (a, s)
    }

    /// LIVE_VERSION 4, the glance: the moments Settings previews (lib/live-samples.js, made by
    /// buildLiveActivity at 1800000000000 ms with the detailed look, time since start, calories
    /// and − + on; trimmed to the set shown and one after it). Their clocks are moved to now.
    private static let glanceBase: Double = 1_800_000_000_000
    private static let glanceJSON: [(String, String, String)] = [
        ("strength", ##"{"v":4,"wid":"preview","start":1799998440000,"accent":"#a3e635","ink":"#0c0e12","labels":{"done":"Log set","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!","nextExercise":"Next exercise","skipRest":"Skip rest","openApp":"Open openGym for the next set","hold":"Hold","getReady":"Get ready","stopAuto":"Stop auto"}}"##,
         ##"{"name":"Push day","cur":{"exId":"0025","entryIdx":0,"setIdx":3,"exName":"Barbell Bench Press","setLine":"Set 3 of 4","target":"80×8","restAfter":90,"unit":0,"tv":{"weight":"80 kg","reps":"8","effort":"RIR –"},"b":["log","wDown","wUp","next"],"adj":{"w":{"v":[70,72.5,75,77.5,80,82.5,85,87.5,90],"t":["70 kg","72.5 kg","75 kg","77.5 kg","80 kg","82.5 kg","85 kg","87.5 kg","90 kg"],"i":4}}},"ahead":[{"exId":"0025","entryIdx":0,"setIdx":4,"exName":"Barbell Bench Press","setLine":"Set 4 of 4","target":"80×8","restAfter":90,"unit":0,"tv":{"weight":"80 kg","reps":"8","effort":"RIR –"},"b":["log","wDown","wUp","next"]}],"unitStarts":[{"exId":"0027","entryIdx":1,"setIdx":0,"exName":"Barbell Bent Over Row","setLine":"Set 1 of 3","target":"60×10","restAfter":90,"unit":1,"tv":{"weight":"60 kg","reps":"10","effort":"RIR –"},"b":["log","wDown","wUp","next"],"fr":true}],"restEndsAt":null,"restLeft":null,"restTotal":null,"holdEndsAt":null,"holdLeft":null,"holdTotal":null,"holdKind":null,"auto":false,"done":3,"total":8,"g":{"lk":"detailed","el":true,"nx":true,"rb":["log","restAdd","restSkip"],"sx":["hr","hrZone","kcal"]},"tl":{"a.log":"Log set","a.restSkip":"Skip rest","a.restAdd":"+15 s","a.finish":"Finish","a.wDown":"Less weight","a.wUp":"More weight","a.next":"Next exercise","a.rDown":"One rep less","a.rUp":"One rep more","nextEx":"Next exercise","elapsed":"Time since start","paused":"Paused"},"tv":{"hr":"130 bpm","hrZone":"Zone 3","kcal":"130 kcal"},"hs":"watch"}"##),
        ("rest", ##"{"v":4,"wid":"preview","start":1799998440000,"accent":"#a3e635","ink":"#0c0e12","labels":{"done":"Log set","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!","nextExercise":"Next exercise","skipRest":"Skip rest","openApp":"Open openGym for the next set","hold":"Hold","getReady":"Get ready","stopAuto":"Stop auto"}}"##,
         ##"{"name":"Push day","cur":{"exId":"0025","entryIdx":0,"setIdx":3,"exName":"Barbell Bench Press","setLine":"Set 3 of 4","target":"80×8","restAfter":90,"unit":0,"tv":{"weight":"80 kg","reps":"8","effort":"RIR –"},"b":["log","wDown","wUp","next"],"adj":{"w":{"v":[70,72.5,75,77.5,80,82.5,85,87.5,90],"t":["70 kg","72.5 kg","75 kg","77.5 kg","80 kg","82.5 kg","85 kg","87.5 kg","90 kg"],"i":4}}},"ahead":[{"exId":"0025","entryIdx":0,"setIdx":4,"exName":"Barbell Bench Press","setLine":"Set 4 of 4","target":"80×8","restAfter":90,"unit":0,"tv":{"weight":"80 kg","reps":"8","effort":"RIR –"},"b":["log","wDown","wUp","next"]}],"unitStarts":[{"exId":"0027","entryIdx":1,"setIdx":0,"exName":"Barbell Bent Over Row","setLine":"Set 1 of 3","target":"60×10","restAfter":90,"unit":1,"tv":{"weight":"60 kg","reps":"10","effort":"RIR –"},"b":["log","wDown","wUp","next"],"fr":true}],"restEndsAt":1800000075000,"restLeft":null,"restTotal":120,"holdEndsAt":null,"holdLeft":null,"holdTotal":null,"holdKind":null,"auto":false,"done":3,"total":8,"g":{"lk":"detailed","el":true,"nx":true,"rb":["log","restAdd","restSkip"],"sx":["hr","hrZone","kcal"]},"tl":{"a.log":"Log set","a.restSkip":"Skip rest","a.restAdd":"+15 s","a.finish":"Finish","a.wDown":"Less weight","a.wUp":"More weight","a.next":"Next exercise","a.rDown":"One rep less","a.rUp":"One rep more","nextEx":"Next exercise","elapsed":"Time since start","paused":"Paused"},"tv":{"hr":"130 bpm","hrZone":"Zone 3","kcal":"130 kcal"},"hs":"watch"}"##),
        ("switch", ##"{"v":4,"wid":"preview","start":1799998440000,"accent":"#a3e635","ink":"#0c0e12","labels":{"done":"Log set","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!","nextExercise":"Next exercise","skipRest":"Skip rest","openApp":"Open openGym for the next set","hold":"Hold","getReady":"Get ready","stopAuto":"Stop auto"}}"##,
         ##"{"name":"Push day","cur":{"exId":"0027","entryIdx":1,"setIdx":0,"exName":"Barbell Bent Over Row","setLine":"Set 1 of 3","target":"60×10","restAfter":90,"unit":1,"tv":{"weight":"60 kg","reps":"10","effort":"RIR –"},"b":["log","wDown","wUp","next"],"fr":true,"adj":{"w":{"v":[40,45,50,55,60,65,70,75,80],"t":["40 kg","45 kg","50 kg","55 kg","60 kg","65 kg","70 kg","75 kg","80 kg"],"i":4}}},"ahead":[{"exId":"0027","entryIdx":1,"setIdx":1,"exName":"Barbell Bent Over Row","setLine":"Set 2 of 3","target":"60×10","restAfter":90,"unit":1,"tv":{"weight":"60 kg","reps":"10","effort":"RIR –"},"b":["log","wDown","wUp","next"],"fr":true}],"unitStarts":[],"restEndsAt":1800000100000,"restLeft":null,"restTotal":150,"holdEndsAt":null,"holdLeft":null,"holdTotal":null,"holdKind":null,"auto":false,"done":5,"total":8,"g":{"lk":"detailed","el":true,"nx":true,"rb":["log","restAdd","restSkip"],"sx":["hr","hrZone","kcal"]},"tl":{"a.log":"Log set","a.restSkip":"Skip rest","a.restAdd":"+15 s","a.finish":"Finish","a.wDown":"Less weight","a.wUp":"More weight","a.next":"Next exercise","a.rDown":"One rep less","a.rUp":"One rep more","nextEx":"Next exercise","elapsed":"Time since start","paused":"Paused"},"tv":{"hr":"138 bpm","hrZone":"Zone 3","kcal":"130 kcal"},"hs":"watch"}"##),
        ("hold", ##"{"v":4,"wid":"preview","start":1799998440000,"accent":"#a3e635","ink":"#0c0e12","labels":{"done":"Log set","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!","nextExercise":"Next exercise","skipRest":"Skip rest","openApp":"Open openGym for the next set","hold":"Hold","getReady":"Get ready","stopAuto":"Stop auto"}}"##,
         ##"{"name":"Push day","cur":{"exId":"0463","entryIdx":0,"setIdx":1,"exName":"Front Plank","setLine":"Set 2 of 3","target":"0:45","restAfter":90,"unit":0,"kd":"hold","sh":"45 s","bg":"45 s","b":["log","next"]},"ahead":[{"exId":"0463","entryIdx":0,"setIdx":2,"exName":"Front Plank","setLine":"Set 3 of 3","target":"0:45","restAfter":90,"unit":0,"kd":"hold","sh":"45 s","bg":"45 s","b":["log","next"]}],"unitStarts":[],"restEndsAt":null,"restLeft":null,"restTotal":null,"holdEndsAt":1800000032000,"holdLeft":null,"holdTotal":45,"holdKind":"hold","auto":false,"done":1,"total":3,"g":{"lk":"detailed","el":true,"nx":true,"rb":["log","restAdd","restSkip"],"sx":["hr","hrZone","kcal"]},"tl":{"a.log":"Log set","a.restSkip":"Skip rest","a.restAdd":"+15 s","a.finish":"Finish","a.wDown":"Less weight","a.wUp":"More weight","a.next":"Next exercise","a.rDown":"One rep less","a.rUp":"One rep more","nextEx":"Next exercise","elapsed":"Time since start","paused":"Paused"},"tv":{"hr":"118 bpm","hrZone":"Zone 2","kcal":"130 kcal"},"hs":"watch"}"##),
        ("cardio", ##"{"v":4,"wid":"preview","start":1799998440000,"accent":"#a3e635","ink":"#0c0e12","labels":{"done":"Log set","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!","nextExercise":"Next exercise","skipRest":"Skip rest","openApp":"Open openGym for the next set","hold":"Hold","getReady":"Get ready","stopAuto":"Stop auto"}}"##,
         ##"{"name":"Push day","cur":{"exId":"2259","entryIdx":0,"setIdx":0,"exName":"Walking On Treadmill","setLine":"Set 1 of 1","target":"20 min @ 8 km/h · 2% incline","restAfter":90,"unit":0,"kd":"cardio","sh":"20 min","b":["log","next"],"fr":true},"ahead":[],"unitStarts":[],"restEndsAt":null,"restLeft":null,"restTotal":null,"holdEndsAt":null,"holdLeft":null,"holdTotal":null,"holdKind":null,"auto":false,"done":0,"total":1,"g":{"lk":"detailed","el":true,"nx":true,"rb":["log","restAdd","restSkip"],"sx":["hr","hrZone","kcal"]},"tl":{"a.log":"Log set","a.restSkip":"Skip rest","a.restAdd":"+15 s","a.finish":"Finish","a.wDown":"Less weight","a.wUp":"More weight","a.next":"Next exercise","a.rDown":"One rep less","a.rUp":"One rep more","nextEx":"Next exercise","elapsed":"Time since start","paused":"Paused"},"tv":{"hr":"142 bpm","hrZone":"Zone 3","kcal":"130 kcal"},"hs":"live"}"##),
        ("carry", ##"{"v":4,"wid":"preview","start":1799998440000,"accent":"#a3e635","ink":"#0c0e12","labels":{"done":"Log set","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!","nextExercise":"Next exercise","skipRest":"Skip rest","openApp":"Open openGym for the next set","hold":"Hold","getReady":"Get ready","stopAuto":"Stop auto"}}"##,
         ##"{"name":"Push day","cur":{"exId":"2133","entryIdx":0,"setIdx":1,"exName":"Farmers Walk","setLine":"Set 2 of 3","target":"40 m · 24","restAfter":90,"unit":0,"kd":"carry","sh":"40 m","bg":"40 m · 24 kg","b":["log","wDown","wUp","next"]},"ahead":[{"exId":"2133","entryIdx":0,"setIdx":2,"exName":"Farmers Walk","setLine":"Set 3 of 3","target":"40 m · 24","restAfter":90,"unit":0,"kd":"carry","sh":"40 m","bg":"40 m · 24 kg","b":["log","wDown","wUp","next"]}],"unitStarts":[],"restEndsAt":null,"restLeft":null,"restTotal":null,"holdEndsAt":null,"holdLeft":null,"holdTotal":null,"holdKind":null,"auto":false,"done":1,"total":3,"g":{"lk":"detailed","el":true,"nx":true,"rb":["log","restAdd","restSkip"],"sx":["hr","hrZone","kcal"]},"tl":{"a.log":"Log set","a.restSkip":"Skip rest","a.restAdd":"+15 s","a.finish":"Finish","a.wDown":"Less weight","a.wUp":"More weight","a.next":"Next exercise","a.rDown":"One rep less","a.rUp":"One rep more","nextEx":"Next exercise","elapsed":"Time since start","paused":"Paused"},"tv":{"hr":"131 bpm","hrZone":"Zone 3","kcal":"130 kcal"},"hs":"watch"}"##),
        ("band", ##"{"v":4,"wid":"preview","start":1799998440000,"accent":"#a3e635","ink":"#0c0e12","labels":{"done":"Log set","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!","nextExercise":"Next exercise","skipRest":"Skip rest","openApp":"Open openGym for the next set","hold":"Hold","getReady":"Get ready","stopAuto":"Stop auto"}}"##,
         ##"{"name":"Push day","cur":{"exId":"1503","entryIdx":0,"setIdx":1,"exName":"Band Pull Apart","setLine":"Set 2 of 3","target":"15 × band","restAfter":90,"unit":0,"kd":"band","tv":{"effort":"RIR –"},"sh":"15×","bg":"15 × Red","b":["log","rDown","rUp","next"],"adj":{"r":{"v":[11,12,13,14,15,16,17,18,19],"t":["11","12","13","14","15","16","17","18","19"],"i":4}}},"ahead":[{"exId":"1503","entryIdx":0,"setIdx":2,"exName":"Band Pull Apart","setLine":"Set 3 of 3","target":"15 × band","restAfter":90,"unit":0,"kd":"band","tv":{"effort":"RIR –"},"sh":"15×","bg":"15 × Red","b":["log","rDown","rUp","next"]}],"unitStarts":[],"restEndsAt":null,"restLeft":null,"restTotal":null,"holdEndsAt":null,"holdLeft":null,"holdTotal":null,"holdKind":null,"auto":false,"done":1,"total":3,"g":{"lk":"detailed","el":true,"nx":true,"rb":["log","restAdd","restSkip"],"sx":["hr","hrZone","kcal"]},"tl":{"a.log":"Log set","a.restSkip":"Skip rest","a.restAdd":"+15 s","a.finish":"Finish","a.wDown":"Less weight","a.wUp":"More weight","a.next":"Next exercise","a.rDown":"One rep less","a.rUp":"One rep more","nextEx":"Next exercise","elapsed":"Time since start","paused":"Paused"},"tv":{"hr":"112 bpm","hrZone":"Zone 2","kcal":"130 kcal"},"hs":"watch"}"##),
        ("superset", ##"{"v":4,"wid":"preview","start":1799998440000,"accent":"#a3e635","ink":"#0c0e12","labels":{"done":"Log set","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!","nextExercise":"Next exercise","skipRest":"Skip rest","openApp":"Open openGym for the next set","hold":"Hold","getReady":"Get ready","stopAuto":"Stop auto"}}"##,
         ##"{"name":"Push day","cur":{"exId":"0025","entryIdx":0,"setIdx":1,"exName":"Barbell Bench Press","setLine":"Set 2 of 4","target":"80×8","restAfter":0,"unit":0,"tv":{"weight":"80 kg","reps":"8","effort":"RIR –","partner":"Superset with Pull-Up"},"ck":["partner"],"b":["log","wDown","wUp","next"],"adj":{"w":{"v":[70,72.5,75,77.5,80,82.5,85,87.5,90],"t":["70 kg","72.5 kg","75 kg","77.5 kg","80 kg","82.5 kg","85 kg","87.5 kg","90 kg"],"i":4}}},"ahead":[{"exId":"0652","entryIdx":1,"setIdx":1,"exName":"Pull-Up","setLine":"Set 2 of 4","target":"8","restAfter":90,"unit":0,"tv":{"weight":"Body weight","reps":"8","effort":"RIR –","partner":"Superset with Barbell Bench Press"},"ck":["partner"],"b":["log","rDown","rUp","next"]}],"unitStarts":[],"restEndsAt":null,"restLeft":null,"restTotal":null,"holdEndsAt":null,"holdLeft":null,"holdTotal":null,"holdKind":null,"auto":false,"done":2,"total":8,"g":{"lk":"detailed","el":true,"nx":true,"rb":["log","restAdd","restSkip"],"sx":["hr","hrZone","kcal"]},"tl":{"a.log":"Log set","a.restSkip":"Skip rest","a.restAdd":"+15 s","a.finish":"Finish","a.wDown":"Less weight","a.wUp":"More weight","a.next":"Next exercise","a.rDown":"One rep less","a.rUp":"One rep more","nextEx":"Next exercise","elapsed":"Time since start","paused":"Paused"},"tv":{"hr":"134 bpm","hrZone":"Zone 3","kcal":"130 kcal"},"hs":"watch"}"##),
        ("done", ##"{"v":4,"wid":"preview","start":1799998440000,"accent":"#a3e635","ink":"#0c0e12","labels":{"done":"Log set","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!","nextExercise":"Next exercise","skipRest":"Skip rest","openApp":"Open openGym for the next set","hold":"Hold","getReady":"Get ready","stopAuto":"Stop auto"}}"##,
         ##"{"name":"Push day","cur":null,"ahead":[],"unitStarts":[],"restEndsAt":null,"restLeft":null,"restTotal":null,"holdEndsAt":null,"holdLeft":null,"holdTotal":null,"holdKind":null,"auto":false,"done":8,"total":8,"g":{"lk":"detailed","el":true,"nx":true,"rb":["log","restAdd","restSkip"],"sx":["hr","hrZone","kcal"]},"tl":{"a.log":"Log set","a.restSkip":"Skip rest","a.restAdd":"+15 s","a.finish":"Finish","a.wDown":"Less weight","a.wUp":"More weight","a.next":"Next exercise","a.rDown":"One rep less","a.rUp":"One rep more","nextEx":"Next exercise","elapsed":"Time since start","paused":"Paused"},"tv":{"hr":"138 bpm","hrZone":"Zone 3","kcal":"130 kcal"},"hs":"watch"}"##),
    ]

    @available(iOS 17.0, *)
    private static func glanceSamples() -> [(String, WorkoutActivityAttributes, WorkoutActivityAttributes.ContentState)] {
        let shift = Date().timeIntervalSince1970 * 1000 - glanceBase
        return glanceJSON.compactMap { (id, attrs, state) in
            guard var a = decode(WorkoutActivityAttributes.self, attrs),
                  var s = decode(WorkoutActivityAttributes.ContentState.self, state) else { return nil }
            if let v = a.start { a.start = v + shift }
            if let v = s.restEndsAt { s.restEndsAt = v + shift }
            if let v = s.holdEndsAt { s.holdEndsAt = v + shift }
            return (id, a, s)
        }
    }

    /// An activity a build before LIVE_VERSION 2 started (no unit, unitStarts or new labels) must
    /// still decode, and shows Log set's old label with no second button.
    @available(iOS 17.0, *)
    private static func liveV1() -> (WorkoutActivityAttributes, WorkoutActivityAttributes.ContentState)? {
        guard let a = decode(WorkoutActivityAttributes.self, """
        {"v":1,"wid":"preview","start":null,"accent":"#a3e635","ink":"#0c0e12",
         "labels":{"done":"Done","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!"}}
        """), let s = decode(WorkoutActivityAttributes.ContentState.self, """
        {"name":"Push Day","cur":null,"ahead":[],"restEndsAt":null,"restLeft":null,"restTotal":null,"done":8,"total":17}
        """) else { return nil }
        return (a, s)
    }

    @available(iOS 17.0, *)
    @MainActor
    private static func render() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("widget-preview")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let now = Date()
        let today = WidgetModel.isoDay(now)
        let plan = WidgetModel(snap: snapshot(today: today), date: now)
        let restDay = WidgetModel(snap: snapshot(today: today).map { var s = $0; s.days.removeFirst(); return s }, date: now)
        let running = WidgetModel(snap: snapshot(today: today, active: #"{"id":"a","name":"Push Day","start":\#((now.timeIntervalSince1970 - 1500) * 1000),"done":6,"total":17}"#), date: now)
        let empty = WidgetModel(snap: nil, date: now)

        func save<V: View>(_ name: String, _ size: CGSize, dark: Bool, radius: CGFloat = 22, padding: CGFloat = 16, @ViewBuilder _ view: () -> V) {
            let framed = view()
                .padding(padding)
                .frame(width: size.width, height: size.height)
                .background(Color(UIColor.systemBackground))
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                .environment(\.colorScheme, dark ? .dark : .light)
            let r = ImageRenderer(content: framed)
            r.scale = 3
            if let data = r.uiImage?.pngData() {
                try? data.write(to: dir.appendingPathComponent("\(name)-\(dark ? "dark" : "light").png"))
            }
        }

        for dark in [false, true] {
            save("small-plan", CGSize(width: 170, height: 170), dark: dark) { SmallWidgetView(model: plan) }
            save("small-rest-day", CGSize(width: 170, height: 170), dark: dark) { SmallWidgetView(model: restDay) }
            save("small-running", CGSize(width: 170, height: 170), dark: dark) { SmallWidgetView(model: running) }
            save("small-empty", CGSize(width: 170, height: 170), dark: dark) { SmallWidgetView(model: empty) }
            save("medium", CGSize(width: 364, height: 170), dark: dark) { MediumWidgetView(model: plan) }
            save("large", CGSize(width: 364, height: 382), dark: dark) { LargeWidgetView(model: plan) }
            if case let (a, s)? = live(rest: false) {
                save("live-lock", CGSize(width: 370, height: 150), dark: dark, radius: 24, padding: 0) { LiveLockView(attributes: a, state: s) }
            }
            if case let (a, s)? = live(rest: true) {
                save("live-lock-resting", CGSize(width: 370, height: 150), dark: dark, radius: 24, padding: 0) { LiveLockView(attributes: a, state: s) }
            }
            if case let (a, s)? = live(rest: true, over: true) {
                save("live-lock-rest-over", CGSize(width: 370, height: 150), dark: dark, radius: 24, padding: 0) { LiveLockView(attributes: a, state: s, isStale: true) }
            }
            for (id, a, s) in glanceSamples() {
                save("glance-lock-\(id)", CGSize(width: 370, height: 160), dark: dark, radius: 24, padding: 0) { GlanceLockView(attributes: a, state: s) }
                save("glance-island-\(id)", CGSize(width: 370, height: 150), dark: true, radius: 44, padding: 14) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top) {
                            GlanceIslandLeading(attributes: a, state: s)
                            Spacer(minLength: 8)
                            GlanceIslandTrailing(attributes: a, state: s)
                        }
                        GlanceIslandBottom(attributes: a, state: s)
                    }
                }
                save("glance-pill-\(id)", CGSize(width: 250, height: 37), dark: true, radius: 18.5, padding: 8) {
                    HStack {
                        GlanceCompactLeading(attributes: a, state: s)
                        Spacer()
                        GlanceCompactTrailing(attributes: a, state: s)
                    }
                }
            }
            if case let (a, s)? = liveV1() {
                save("live-lock-v1-open-app", CGSize(width: 370, height: 150), dark: dark, radius: 24, padding: 0) { LiveLockView(attributes: a, state: s) }
            }
        }
        // The configurable "openGym" widget (v1.4.4): every kind small, two pairs medium.
        for dark in [false, true] {
            for kind in GymWidgetKind.allCases {
                save("pick-small-\(kind.rawValue)", CGSize(width: 170, height: 170), dark: dark) { KindBlock(model: plan, c: plan.content(kind)) }
            }
            for (a, b) in [(GymWidgetKind.streak, GymWidgetKind.weight), (.next, .volume)] {
                save("pick-medium-\(a.rawValue)-\(b.rawValue)", CGSize(width: 364, height: 170), dark: dark) {
                    HStack(spacing: 14) { KindBlock(model: plan, c: plan.content(a)); Divider(); KindBlock(model: plan, c: plan.content(b)) }
                }
            }
        }
        for kind in GymWidgetKind.allCases {
            save("pick-lock-circle-\(kind.rawValue)", CGSize(width: 76, height: 76), dark: true, radius: 38, padding: 0) { KindCircleView(c: plan.content(kind)) }
            save("pick-lock-rect-\(kind.rawValue)", CGSize(width: 172, height: 76), dark: true, radius: 12, padding: 6) { KindRectView(c: plan.content(kind)) }
        }
        // The Lock Screen's accessories and the Dynamic Island are drawn light on dark.
        save("lock-rect", CGSize(width: 172, height: 76), dark: true, radius: 12, padding: 6) { NextRectView(model: plan) }
        save("lock-circle", CGSize(width: 76, height: 76), dark: true, radius: 38, padding: 0) { StreakCircleView(model: plan) }
        save("lock-inline", CGSize(width: 260, height: 30), dark: true, radius: 6, padding: 4) { NextInlineView(model: plan) }
        if case let (a, s)? = live(rest: true) {
            save("island-compact", CGSize(width: 250, height: 37), dark: true, radius: 18.5, padding: 8) {
                HStack {
                    OpenGymMark()
                    Spacer()
                    LiveCompactTrailing(attributes: a, state: s)
                }
            }
            save("island-minimal", CGSize(width: 37, height: 37), dark: true, radius: 18.5, padding: 2) { LiveMinimal(attributes: a, state: s) }
        }
        try? "done".write(to: dir.appendingPathComponent("done.txt"), atomically: true, encoding: .utf8)
    }
}
