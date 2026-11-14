# Generates the synthetic profile the EP-02 browser scripts load: python3 fixture.py > state.json
# One routine (two exercises), four workouts (ids ep02-w0..3), three weigh-ins, rest 90 s. No real data.
import json, datetime
today = datetime.date.today()
d = lambda n: (today - datetime.timedelta(days=n)).isoformat()
S = {"lang": "en", "theme": "dark", "accent": "lime", "weighIn": False, "tourDone": True, "restSec": 90,
     "routines": [{"id": "r1", "name": "Full Body A", "emoji": "dumbbell", "ex": [{"id": "0025", "sets": 3, "reps": 10}, {"id": "0001", "sets": 3, "reps": 12}]}],
     "week": {str(i): "r1" for i in range(7)},
     "workouts": [{"id": "ep02-w%d" % i, "d": d(i * 3 + 1), "name": "Full Body A", "start": 1, "end": 2, "prs": [],
                   "entries": [{"id": "0025", "target": {"mode": "reps"}, "sets": [{"w": 40 + i, "r": 10, "done": True}]}]} for i in range(4)],
     "bodyweight": [{"d": d(14), "w": 83.0}, {"d": d(7), "w": 82.8}, {"d": d(1), "w": 82.4}]}
print(json.dumps(S, indent=1))
