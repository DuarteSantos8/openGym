// The sheets, split by domain under src/sheets/. This file is the facade: every consumer (and every
// vi.mock('../sheets.jsx')) goes through it, so the names below are the public surface. Named
// re-exports only; nothing outside this file and src/sheets/ imports src/sheets/* (guard G6).
export { addDeviceDataMessage, addDeviceSetupMessage, askAddDeviceData, menuSheet, confirmSheet } from './sheets/confirm-menu.jsx'
export { loadStarterPlan, starterPlanSheet } from './sheets/starter.jsx'
export { bwSheet, weighInsSheet, bwDeltaColor, goalSheet } from './sheets/body-weight.jsx'
export { importFromApp, importFromHevy } from './sheets/import.jsx'
export { barWeightSheet, plateInventorySheet, dumbbellInventorySheet, equipmentProfileSheet } from './sheets/equipment.jsx'
export { detailTags, exerciseDetailSheet, exerciseHistorySheet, addToRoutineSheet, customExSheet, deleteCustomEx } from './sheets/exercise.jsx'
export { exercisePicker, swapActiveWorkoutExercise } from './sheets/exercise-picker.jsx'
export { exConfigSheet, glyphPicker, effortPickerSheet } from './sheets/exercise-config.jsx'
export { planToolsSheet, planHasRoutines, exportPlanFile, printWholePlan, importPlanFile, planImportSheet, dayOverrideSheet, dayNoteSheet, dayAssignSheet } from './sheets/plan.jsx'
export { workoutDateSheet, workoutDurationSheet, workoutDetailSheet, calendarSheet, WorkoutRow, DayNoteRow } from './sheets/workout-detail.jsx'
export {
  startOrResume, startFlow, beginWorkout, repeatWorkout, logPastWorkoutSheet, addRoutineToSessionSheet,
  exerciseNoteSheet, setNoteSheet, sessionNoteSheet, renameWorkoutSheet, supersetSheet, workoutCompleteSheet,
  saveWorkoutEdits, exitWorkoutEdit, setsLine, finishWorkout, finishWorkoutSheet,
} from './sheets/workout-flow.jsx'
