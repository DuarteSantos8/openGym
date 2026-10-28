// MCP-owned copy. Locale selection is intentionally independent of the browser's i18n runtime.
// OPENGYM_LOCALE accepts a language tag; unknown or missing locales keep the English contract.
const EN = {
  tool_list_routines: "List the workout routines saved in the user's openGym profile (the same list the Plan screen shows). Each routine is a named set of exercises with set/rep targets. Use this to discover the plan structure before diving into a specific routine or today's workout.",
  tool_get_routine: "Get the full exercise list for a single routine (the same view the routine editor shows). Returns mode (reps/time/cardio), set/rep/weight targets (a `pyramid` list of per-set rep targets, 'max' meaning as many reps as possible, when the exercise uses pyramid sets, with `pyramid_rest_sec` and `pyramid_weight` per set where planned, 0 meaning the exercise's rest or last time's weight), superset links, any per-exercise custom increment or Epley deload factor, and each exercise's own rest in seconds (absent means it inherits the global rest timer). Use routine_id from list_routines.",
  tool_get_week_plan: 'Show the user\'s training plan. `days` is the authoritative answer to "what is planned when": the next seven dates from today with the routines planned for each (a date can hold several — a combined day) and how each was decided: a coach-week session ("coach"), a session the user pinned to that date ("pinned"), a one-off routine override ("override"), a "rest" override ("rest_override"), the weekday plan ("weekday") or nothing ("rest"). `coach_week` is the current coach week when one is running (a week written by an external planner through the API, never by the app): its sessions are done IN ORDER on whatever days the user trains (no weekday attached), the first undone one is today\'s session, a session can be pinned to a date, and `waiting` means the week starts on `starts_on`. `weekdays` is the user\'s own weekly plan keyed by JS getDay() (Sunday=0 … Saturday=6, the openGym state convention) — in a coach week it holds only the routines the user planned themselves, which ride along beside the coach-week session.',
  tool_list_workouts: 'List recent finished workouts, newest first. Each item summarises the date, exercise count, sets done / planned, total volume (in the user\'s unit), duration and whether PRs were set. Use this before drilling into a specific date with get_workout.',
  tool_get_workout: 'Get the full breakdown of one workout: every exercise, its mode (reps/time/cardio), the target, and per-set labels (e.g. "5 @ 60 kg", "1:30 · 20 kg"). Identify it by workout_id (from list_workouts) or by date. Use list_workouts first if you don\'t know either.',
  tool_get_bodyweight: 'Get the body-weight log: chronological weigh-ins with weights, current goal, deltas vs goal (signed positive = above goal), and a latest summary. Useful for "am I trending toward my weight goal?" questions.',
  tool_estimate_1rm: 'Estimate one-rep max using Epley, Brzycki or Lombardi formulas. If an exercise_id is given, returns the all-time best estimate for that exercise with the source set (weight × reps + date) and the trend across history. If no exercise_id is given, returns a PR table across all reps-mode exercises (sorted highest first). Refuses to guess above {cap} reps — above that, formulas diverge past 10% and "work capacity" is read instead of "maximal strength".',
  tool_muscle_balance: 'Show which muscles the user has trained in a period, ranked by "effective sets" (volume in kg is intentionally not used — 100 kg leg press vs 12 kg lateral raise say nothing about which muscle worked harder). Reports worked muscles with a 0-4 relative level (1 = some work, 4 = most worked) and the muscles trained zero times in that period — useful for "what am I neglecting?" questions.',
  tool_preview_session: 'Preview the session a routine will actually open with — the numbers the user will see after the progression policy and their training history have overridden the routine\'s own targets. This is NOT the same as get_routine: a routine storing "squat 3x8 @ 60kg" can open at 75kg because the policy progressed or deloaded from that routine\'s last logged session. The reps are the routine\'s own unless a policy that moves reps moved them, or the profile starts planned sessions from the last session (starts_from). Always call this (not get_routine) before telling someone what weight they are about to lift, or before judging whether an edit to a routine had any effect. Returns, per exercise, the planned target, the policy\'s decision and its stated reason, the opening set rows, and where each number came from. Defaults to today\'s scheduled routine.',
  arg_from_workouts: 'Inclusive start date YYYY-MM-DD. Defaults to no lower bound (list most recent).',
  arg_from_bodyweight: 'Inclusive start date YYYY-MM-DD.',
  arg_to: 'Inclusive end date YYYY-MM-DD. Defaults to today.',
  arg_workout_limit: 'Max items to return. Defaults to 25.',
  arg_workout_date: 'The workout date as YYYY-MM-DD. If two sessions share that date, the answer lists them instead and asks for a workout_id.',
  arg_workout_id: 'The id from list_workouts. Preferred: it names one session even on a day with two.',
  arg_estimate_exercise: 'An exercise id from list_routines or get_workout entries. If omitted, returns a full PR table.',
  arg_formula: 'Formula to use. Defaults to {formula}.',
  arg_period: 'window: last 7 days, last 30 days, or all-time',
  arg_preview_routine: 'Routine to preview. Defaults to the routine scheduled for `date`.',
  arg_preview_date: 'Date the session would be started on, YYYY-MM-DD. Affects which routine is scheduled and any one-off day override. Defaults to today.',
  date_format: 'must be YYYY-MM-DD',
  invalid_date: 'not a date the calendar has (YYYY-MM-DD)',
  invalid_uid: 'OPENGYM_UID is invalid. Check the server configuration.',
  missing_data_dir: 'The openGym data directory is unavailable. Check OPENGYM_DATA and the server configuration.',
  no_state: 'no synced state yet — sign in at least once from a device so the openGym api can save a state file for this profile',
  no_routine: 'no routine with id {id}',
  no_workout_id: 'no workout with id {id}',
  no_workout_date: 'no workout on {date}',
  need_workout_selector: 'get_workout needs either workout_id or date',
  ambiguous_workouts: '{count} workouts were logged on {date} — call get_workout again with one of these workout_id values.',
  no_routine_scheduled: 'no routine is scheduled for this date (rest day)',
  estimate_note: 'Estimates use the {formula} formula. Cap at {cap} reps applies; r=1 is treated as the measurement, not an estimate.',
  no_qualifying_sets: 'This exercise has logged sets, but none of them qualify: every set was above the {cap}-rep cap, or carried no weight. That is not the same as never having trained it.',
  unknown_exercise: 'No exercise with id {id} exists — not in the catalogue, not among this profile\'s custom exercises, and nothing is logged against it. Check the id against list_routines or a get_workout entry.',
  no_completed_sets: 'No completed sets logged for this exercise.',
  weekday_names: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  policy_names: { off: 'No automatic progression', linear: 'Linear progression', greyskull: 'Greyskull LP', double: 'Double progression', triple: 'Triple progression', time: 'Add time' },
  source_progression: 'the progression policy overrode the routine',
  source_confirmed_weight: 'your confirmed working weight for this exercise',
  source_last_session: 'carried over from the last time this routine had this exercise (or any routine, if this one never has)',
  source_routine_plan: "the routine's own target",
  muscle_names: {}
}

const IT = {
  tool_list_routines: 'Elenca le schede salvate nel profilo openGym dell’utente, come nella schermata Piano. Ogni scheda contiene esercizi con obiettivi di serie e ripetizioni. Usa questo strumento per vedere la struttura del piano prima di chiedere una scheda specifica o l’allenamento di oggi.',
  tool_get_routine: 'Mostra tutti gli esercizi di una scheda, come nell’editor. Restituisce modalità (ripetizioni, tempo o cardio), obiettivi di serie, ripetizioni e peso, eventuali serie piramidali con recupero e peso per serie, collegamenti in superserie, incrementi personalizzati, fattore di scarico Epley e recupero di ogni esercizio in secondi. Se il recupero non è indicato, vale il timer globale. Usa routine_id ottenuto da list_routines.',
  tool_get_week_plan: 'Mostra il piano di allenamento. `days` è il riferimento per sapere cosa è previsto nelle prossime sette date: le schede assegnate e il motivo, indicato da `planned_by` come `coach`, `pinned`, `override`, `rest_override`, `weekday` o `rest`. `coach_week`, se attiva, è una settimana scritta da un pianificatore esterno tramite API, non dall’app. Le sue sessioni si svolgono IN ORDINE nei giorni in cui l’utente si allena, senza un giorno della settimana associato. La prima sessione non completata è quella di oggi. Una sessione può essere fissata a una data con `pinned_to`; se `waiting` è vero, la settimana inizia il giorno indicato da `starts_on`. `weekdays` è il piano settimanale scelto dall’utente, indicizzato secondo JS getDay() (domenica=0 … sabato=6). Durante una settimana del coach contiene solo le schede personali, che si svolgono insieme alla sessione del coach.',
  tool_list_workouts: 'Elenca gli allenamenti completati più recenti, dal più nuovo. Ogni elemento riporta data, numero di esercizi, serie completate e previste, volume totale nell’unità del profilo, durata e record personali. Usa questo strumento prima di cercare una sessione specifica con get_workout.',
  tool_get_workout: 'Mostra tutti i dettagli di un allenamento: esercizi, modalità, obiettivi ed etichette delle serie. Identificalo con workout_id (da list_workouts) oppure con la data. Se non conosci l’identificativo, usa prima list_workouts.',
  tool_get_bodyweight: 'Mostra il registro del peso corporeo in ordine cronologico, l’obiettivo attuale, la differenza dall’obiettivo (positiva se il peso è superiore) e l’ultimo dato. Utile per capire l’andamento verso l’obiettivo.',
  tool_estimate_1rm: 'Stima il massimale per una ripetizione con le formule Epley, Brzycki o Lombardi. Con exercise_id restituisce la stima migliore, la serie di origine e l’andamento storico. Senza exercise_id restituisce la tabella dei record per tutti gli esercizi a ripetizioni. Oltre {cap} ripetizioni non stima il massimale, perché le formule divergono e misurano più la capacità di lavoro che la forza massimale.',
  tool_muscle_balance: 'Mostra i muscoli allenati nel periodo, ordinati per serie efficaci. Il volume in kg non viene usato per confrontare il lavoro muscolare. Il livello relativo va da 0 a 4: 1 indica un po’ di lavoro, 4 il maggior lavoro. Include anche i muscoli mai allenati nel periodo.',
  tool_preview_session: 'Prevede i valori con cui si aprirà una sessione, dopo gli effetti della progressione e dello storico di allenamento. È diverso da get_routine, che mostra i valori salvati nella scheda. Per ogni esercizio riporta obiettivo, decisione della progressione, serie iniziali e origine dei valori. Se non specifichi una scheda, usa quella prevista per oggi.',
  arg_from_workouts: 'Data iniziale inclusiva nel formato YYYY-MM-DD. Se omessa, non applica un limite iniziale.',
  arg_from_bodyweight: 'Data iniziale inclusiva nel formato YYYY-MM-DD.',
  arg_to: 'Data finale inclusiva nel formato YYYY-MM-DD. Se omessa, usa oggi.',
  arg_workout_limit: 'Numero massimo di elementi. Se omesso, usa 25.',
  arg_workout_date: 'Data dell’allenamento nel formato YYYY-MM-DD. Se ci sono più sessioni nella stessa data, le elenca tutte e chiede un workout_id.',
  arg_workout_id: 'Identificativo ottenuto da list_workouts. Consigliato perché individua una singola sessione anche quando ce ne sono più nella stessa data.',
  arg_estimate_exercise: 'Identificativo di un esercizio presente in list_routines o tra gli esercizi di get_workout. Se omesso, restituisce tutti i record personali.',
  arg_formula: 'Formula da usare. Il valore predefinito è {formula}.',
  arg_period: 'Intervallo: ultimi 7 giorni, ultimi 30 giorni o tutto lo storico.',
  arg_preview_routine: 'Scheda da prevedere. Se omessa, usa quella prevista per `date`.',
  arg_preview_date: 'Data di avvio della sessione nel formato YYYY-MM-DD. Determina la scheda prevista e le eventuali modifiche per quel giorno. Se omessa, usa oggi.',
  date_format: 'il formato deve essere YYYY-MM-DD',
  invalid_date: 'data non valida per il calendario (YYYY-MM-DD)',
  invalid_uid: 'OPENGYM_UID non valido. Controlla la configurazione del server.',
  missing_data_dir: 'La directory dei dati openGym non è disponibile. Controlla OPENGYM_DATA e la configurazione del server.',
  no_state: 'Non ci sono ancora dati sincronizzati. Accedi almeno una volta da un dispositivo per salvare il profilo sul server openGym.',
  no_routine: 'Nessuna scheda con identificativo {id}.',
  no_workout_id: 'Nessun allenamento con identificativo {id}.',
  no_workout_date: 'Nessun allenamento nella data {date}.',
  need_workout_selector: 'get_workout richiede workout_id oppure date.',
  ambiguous_workouts: 'Sono stati registrati {count} allenamenti il {date}. Richiama get_workout indicando uno dei workout_id elencati.',
  no_routine_scheduled: 'Nessuna scheda prevista per questa data (giorno di riposo).',
  estimate_note: 'Stime calcolate con la formula {formula}. Il limite è {cap} ripetizioni; r=1 è il dato misurato, non una stima.',
  no_qualifying_sets: 'L’esercizio ha delle serie registrate, ma nessuna è valida: tutte superano il limite di {cap} ripetizioni oppure non hanno un peso. Non significa che l’esercizio non sia mai stato allenato.',
  unknown_exercise: 'Non esiste un esercizio con identificativo {id}: non è nel catalogo, tra gli esercizi personalizzati del profilo o nello storico. Controlla l’identificativo in list_routines o get_workout.',
  no_completed_sets: 'Nessuna serie completata registrata per questo esercizio.',
  weekday_names: ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'],
  source_progression: 'la progressione ha modificato i valori della scheda',
  source_confirmed_weight: 'il peso di lavoro confermato per questo esercizio',
  source_last_session: 'ripreso dall’ultima sessione in cui era presente questo esercizio',
  source_routine_plan: 'l’obiettivo impostato nella scheda',
  policy_names: { off: 'Progressione automatica disattivata', linear: 'Progressione lineare', greyskull: 'Greyskull LP', double: 'Doppia progressione', triple: 'Tripla progressione', time: 'Aggiunta di tempo' },
  muscle_names: { trapezius: 'Trapezi', deltoids: 'Spalle', chest: 'Petto', 'upper-back': 'Parte alta della schiena', serratus: 'Dentato', biceps: 'Bicipiti', triceps: 'Tricipiti', forearm: 'Avambracci', abs: 'Addominali', obliques: 'Obliqui', 'lower-back': 'Parte bassa della schiena', gluteal: 'Glutei', quadriceps: 'Quadricipiti', hamstring: 'Ischiocrurali', adductors: 'Adduttori', 'hip-flexors': 'Flessori dell’anca', calves: 'Polpacci', tibialis: 'Tibiali' }
}

export function localeCode(locale = process.env.OPENGYM_LOCALE) {
  const raw = String(locale || 'en').trim().replaceAll('_', '-')
  const base = raw.toLowerCase().split('-')[0]
  return base === 'it' ? 'it' : 'en'
}

export function t(key, params = {}, locale = process.env.OPENGYM_LOCALE) {
  const copy = localeCode(locale) === 'it' ? IT : EN
  let value = copy[key] ?? EN[key] ?? key
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return value
  return String(value).replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match)
}
