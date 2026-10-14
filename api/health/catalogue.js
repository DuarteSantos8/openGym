/* Every kind of reading Apple Health records that openGym takes in, in one table: the server (an
 * iPhone Shortcut, Health Auto Export), the web app (Health's own export), the iPhone app
 * (HealthKit, ios/App/App/HealthKitPlugin.swift) and the health area's screens all read it from
 * here, so a type added once is read, converted, folded, kept and shown the same way everywhere.
 *
 * A row: [type, HealthKit identifier, group, kind, unit, dim, decimals, min, max, label, extra]
 *   identifier  HKQuantityTypeIdentifier… or HKCategoryTypeIdentifier… without its prefix
 *   group       the health area's tab
 *   kind        how a day of samples becomes one reading:
 *                 sample  every sample kept, keyed by its time (body readings)
 *                 sum     the day's total (steps, energy, food)
 *                 range   the day's mean, with its lowest and highest (heart rate)
 *                 mean    the day's mean (every other measurement)
 *                 sleep   minutes asleep of the night, on the day it ended
 *                 min     minutes of the category's spans that started that day (mindfulness)
 *                 ev      how many times that day (a notification, a toothbrushing)
 *                 lvl     the day's highest level (a symptom's severity, menstrual flow)
 *                 val     the day's latest answer (an ovulation test)
 *                 wo      a workout, one reading each (the WORKOUT row below)
 *   unit, dim   the canonical unit a value is kept in and how other units convert to it (DIMS)
 *   min, max    what a value may be, in that unit: outside it nothing was measured
 *   label       the English name on screen (a key for the app's translations)
 *   extra       { cat } a category's values (CATS), { hae } Health Auto Export's name for it when
 *               it is not the label's, { core } kept the longest when the profile runs out of room
 *
 * Plain JavaScript with no imports, loadable by bare node (the server) and by Vite (the app). */

const Q = 'HKQuantityTypeIdentifier', C = 'HKCategoryTypeIdentifier';
const CORE = { core: true };
const N = 1e6; // a generous ceiling for food values in small units

const ROWS = [
  // ---- body: every reading kept as it was taken
  ['weight', Q + 'BodyMass', 'body', 'sample', 'kg', 'mass', 1, 1, 700, 'Weight', { core: true, hae: 'weight_body_mass' }],
  ['bmi', Q + 'BodyMassIndex', 'body', 'sample', '', 'plain', 1, 5, 150, 'BMI', { core: true, hae: 'body_mass_index' }],
  ['bodyFat', Q + 'BodyFatPercentage', 'body', 'sample', '%', 'percent', 1, 1, 80, 'Body fat', { core: true, hae: 'body_fat_percentage' }],
  ['leanMass', Q + 'LeanBodyMass', 'body', 'sample', 'kg', 'mass', 1, 1, 400, 'Lean mass', { core: true, hae: 'lean_body_mass' }],
  ['height', Q + 'Height', 'body', 'sample', 'cm', 'length', 0, 50, 260, 'Height', CORE],
  ['waist', Q + 'WaistCircumference', 'body', 'sample', 'cm', 'length', 1, 30, 250, 'Waist circumference'],
  // ---- activity
  ['steps', Q + 'StepCount', 'activity', 'sum', 'count', 'plain', 0, 0, 200000, 'Steps', { core: true, hae: 'step_count' }],
  ['distance', Q + 'DistanceWalkingRunning', 'activity', 'sum', 'km', 'distance', 2, 0, 500, 'Distance', { core: true, hae: 'walking_running_distance' }],
  ['activeEnergy', Q + 'ActiveEnergyBurned', 'activity', 'sum', 'kcal', 'energy', 0, 0, 20000, 'Active calories', { core: true, hae: 'active_energy' }],
  ['restingEnergy', Q + 'BasalEnergyBurned', 'activity', 'sum', 'kcal', 'energy', 0, 0, 10000, 'Resting calories', { core: true, hae: 'basal_energy_burned' }],
  ['exerciseTime', Q + 'AppleExerciseTime', 'activity', 'sum', 'min', 'time', 0, 0, 1440, 'Exercise minutes', { hae: 'apple_exercise_time' }],
  ['standTime', Q + 'AppleStandTime', 'activity', 'sum', 'min', 'time', 0, 0, 1440, 'Stand minutes', { hae: 'apple_stand_time' }],
  ['standHours', C + 'AppleStandHour', 'activity', 'ev', 'count', 'plain', 0, 0, 24, 'Stand hours', { cat: 'stand', hae: 'apple_stand_hour' }],
  ['moveTime', Q + 'AppleMoveTime', 'activity', 'sum', 'min', 'time', 0, 0, 1440, 'Move minutes', { hae: 'apple_move_time' }],
  ['flights', Q + 'FlightsClimbed', 'activity', 'sum', 'count', 'plain', 0, 0, 10000, 'Flights climbed', { hae: 'flights_climbed' }],
  ['daylight', Q + 'TimeInDaylight', 'activity', 'sum', 'min', 'time', 0, 0, 1440, 'Time in daylight', { hae: 'time_in_daylight' }],
  ['physicalEffort', Q + 'PhysicalEffort', 'activity', 'mean', 'kcal/hr·kg', 'plain', 1, 0, 50, 'Physical effort'],
  ['cyclingDistance', Q + 'DistanceCycling', 'activity', 'sum', 'km', 'distance', 2, 0, 2000, 'Cycling distance', { hae: 'cycling_distance' }],
  ['swimDistance', Q + 'DistanceSwimming', 'activity', 'sum', 'km', 'distance', 2, 0, 200, 'Swimming distance', { hae: 'swimming_distance' }],
  ['swimStrokes', Q + 'SwimmingStrokeCount', 'activity', 'sum', 'count', 'plain', 0, 0, 100000, 'Swimming strokes', { hae: 'swimming_stroke_count' }],
  ['wheelchairDistance', Q + 'DistanceWheelchair', 'activity', 'sum', 'km', 'distance', 2, 0, 500, 'Wheelchair distance'],
  ['pushes', Q + 'PushCount', 'activity', 'sum', 'count', 'plain', 0, 0, 100000, 'Wheelchair pushes', { hae: 'push_count' }],
  ['snowDistance', Q + 'DistanceDownhillSnowSports', 'activity', 'sum', 'km', 'distance', 2, 0, 1000, 'Downhill snow sports distance'],
  ['rowingDistance', Q + 'DistanceRowing', 'activity', 'sum', 'km', 'distance', 2, 0, 500, 'Rowing distance'],
  ['paddleDistance', Q + 'DistancePaddleSports', 'activity', 'sum', 'km', 'distance', 2, 0, 500, 'Paddle sports distance'],
  ['skiDistance', Q + 'DistanceCrossCountrySkiing', 'activity', 'sum', 'km', 'distance', 2, 0, 500, 'Cross-country skiing distance'],
  ['skatingDistance', Q + 'DistanceSkatingSports', 'activity', 'sum', 'km', 'distance', 2, 0, 500, 'Skating distance'],
  ['runningSpeed', Q + 'RunningSpeed', 'activity', 'mean', 'km/hr', 'speed', 1, 0, 60, 'Running speed'],
  ['runningPower', Q + 'RunningPower', 'activity', 'mean', 'W', 'plain', 0, 0, 3000, 'Running power'],
  ['runningStride', Q + 'RunningStrideLength', 'activity', 'mean', 'cm', 'length', 0, 10, 500, 'Running stride length'],
  ['runningOscillation', Q + 'RunningVerticalOscillation', 'activity', 'mean', 'cm', 'length', 1, 0, 50, 'Vertical oscillation'],
  ['groundContact', Q + 'RunningGroundContactTime', 'activity', 'mean', 'ms', 'time', 0, 0, 3000, 'Ground contact time'],
  ['cyclingSpeed', Q + 'CyclingSpeed', 'activity', 'mean', 'km/hr', 'speed', 1, 0, 150, 'Cycling speed'],
  ['cyclingPower', Q + 'CyclingPower', 'activity', 'mean', 'W', 'plain', 0, 0, 3000, 'Cycling power'],
  ['cyclingFtp', Q + 'CyclingFunctionalThresholdPower', 'activity', 'mean', 'W', 'plain', 0, 0, 3000, 'Functional threshold power'],
  ['cyclingCadence', Q + 'CyclingCadence', 'activity', 'mean', 'count/min', 'plain', 0, 0, 300, 'Cycling cadence'],
  ['rowingSpeed', Q + 'RowingSpeed', 'activity', 'mean', 'km/hr', 'speed', 1, 0, 60, 'Rowing speed'],
  ['paddleSpeed', Q + 'PaddleSportsSpeed', 'activity', 'mean', 'km/hr', 'speed', 1, 0, 60, 'Paddle sports speed'],
  ['skiSpeed', Q + 'CrossCountrySkiingSpeed', 'activity', 'mean', 'km/hr', 'speed', 1, 0, 60, 'Cross-country skiing speed'],
  ['underwaterDepth', Q + 'UnderwaterDepth', 'activity', 'mean', 'm', 'plain', 1, 0, 1000, 'Underwater depth'],
  ['waterTemperature', Q + 'WaterTemperature', 'activity', 'mean', 'degC', 'temp', 1, -5, 50, 'Water temperature'],
  // ---- heart
  ['heartRate', Q + 'HeartRate', 'heart', 'range', 'bpm', 'plain', 0, 20, 250, 'Heart rate', CORE],
  ['restingHeartRate', Q + 'RestingHeartRate', 'heart', 'mean', 'bpm', 'plain', 0, 20, 200, 'Resting heart rate', CORE],
  ['walkingHeartRate', Q + 'WalkingHeartRateAverage', 'heart', 'mean', 'bpm', 'plain', 0, 20, 250, 'Walking heart rate average', { hae: 'walking_heart_rate_average' }],
  ['hrv', Q + 'HeartRateVariabilitySDNN', 'heart', 'mean', 'ms', 'time', 0, 1, 500, 'Heart rate variability', { hae: 'heart_rate_variability' }],
  ['hrRecovery', Q + 'HeartRateRecoveryOneMinute', 'heart', 'mean', 'bpm', 'plain', 0, 0, 150, 'Heart rate recovery'],
  ['vo2max', Q + 'VO2Max', 'heart', 'mean', 'mL/kg·min', 'plain', 1, 5, 100, 'Cardio fitness', { hae: 'vo2_max' }],
  ['afibBurden', Q + 'AtrialFibrillationBurden', 'heart', 'mean', '%', 'percent', 1, 0, 100, 'AFib history'],
  ['highHeartRate', C + 'HighHeartRateEvent', 'heart', 'ev', 'count', 'plain', 0, 0, 100, 'High heart rate notifications'],
  ['lowHeartRate', C + 'LowHeartRateEvent', 'heart', 'ev', 'count', 'plain', 0, 0, 100, 'Low heart rate notifications'],
  ['irregularRhythm', C + 'IrregularHeartRhythmEvent', 'heart', 'ev', 'count', 'plain', 0, 0, 100, 'Irregular rhythm notifications'],
  ['lowCardioFitness', C + 'LowCardioFitnessEvent', 'heart', 'ev', 'count', 'plain', 0, 0, 100, 'Low cardio fitness notifications'],
  // ---- vitals and respiratory
  ['spo2', Q + 'OxygenSaturation', 'vitals', 'mean', '%', 'percent', 0, 50, 100, 'Blood oxygen', { hae: 'blood_oxygen_saturation' }],
  ['respiratoryRate', Q + 'RespiratoryRate', 'vitals', 'mean', 'count/min', 'plain', 1, 1, 100, 'Respiratory rate', { hae: 'respiratory_rate' }],
  ['bodyTemperature', Q + 'BodyTemperature', 'vitals', 'mean', 'degC', 'temp', 1, 25, 45, 'Body temperature', { hae: 'body_temperature' }],
  ['wristTemperature', Q + 'AppleSleepingWristTemperature', 'vitals', 'mean', 'degC', 'temp', 2, 25, 45, 'Wrist temperature', { hae: 'apple_sleeping_wrist_temperature' }],
  ['systolic', Q + 'BloodPressureSystolic', 'vitals', 'mean', 'mmHg', 'plain', 0, 40, 300, 'Systolic blood pressure', { hae: 'blood_pressure_systolic' }],
  ['diastolic', Q + 'BloodPressureDiastolic', 'vitals', 'mean', 'mmHg', 'plain', 0, 20, 200, 'Diastolic blood pressure', { hae: 'blood_pressure_diastolic' }],
  ['glucose', Q + 'BloodGlucose', 'vitals', 'mean', 'mg/dL', 'glucose', 0, 10, 1000, 'Blood glucose', { hae: 'blood_glucose' }],
  ['perfusion', Q + 'PeripheralPerfusionIndex', 'vitals', 'mean', '%', 'percent', 1, 0, 100, 'Perfusion index'],
  ['electrodermal', Q + 'ElectrodermalActivity', 'vitals', 'mean', 'mcS', 'plain', 2, 0, 100, 'Electrodermal activity'],
  ['bloodAlcohol', Q + 'BloodAlcoholContent', 'vitals', 'mean', '%', 'percent', 3, 0, 1, 'Blood alcohol content'],
  ['insulin', Q + 'InsulinDelivery', 'vitals', 'sum', 'IU', 'plain', 1, 0, 1000, 'Insulin delivery'],
  ['inhaler', Q + 'InhalerUsage', 'vitals', 'sum', 'count', 'plain', 0, 0, 100, 'Inhaler usage'],
  ['fvc', Q + 'ForcedVitalCapacity', 'vitals', 'mean', 'L', 'volumeL', 2, 0, 10, 'Forced vital capacity'],
  ['fev1', Q + 'ForcedExpiratoryVolume1', 'vitals', 'mean', 'L', 'volumeL', 2, 0, 10, 'Forced expiratory volume'],
  ['peakFlow', Q + 'PeakExpiratoryFlowRate', 'vitals', 'mean', 'L/min', 'plain', 0, 0, 1000, 'Peak expiratory flow'],
  ['uvExposure', Q + 'UVExposure', 'vitals', 'mean', 'count', 'plain', 0, 0, 20, 'UV index'],
  // ---- sleep
  ['sleep', C + 'SleepAnalysis', 'sleep', 'sleep', 'min', 'time', 0, 0, 1440, 'Sleep', { core: true, hae: 'sleep_analysis' }],
  ['breathingDisturbances', Q + 'AppleSleepingBreathingDisturbances', 'sleep', 'mean', 'count', 'plain', 1, 0, 100, 'Breathing disturbances'],
  // ---- mobility
  ['walkingSpeed', Q + 'WalkingSpeed', 'mobility', 'mean', 'km/hr', 'speed', 1, 0, 20, 'Walking speed', { hae: 'walking_speed' }],
  ['stepLength', Q + 'WalkingStepLength', 'mobility', 'mean', 'cm', 'length', 0, 10, 200, 'Walking step length', { hae: 'walking_step_length' }],
  ['walkingAsymmetry', Q + 'WalkingAsymmetryPercentage', 'mobility', 'mean', '%', 'percent', 1, 0, 100, 'Walking asymmetry', { hae: 'walking_asymmetry_percentage' }],
  ['doubleSupport', Q + 'WalkingDoubleSupportPercentage', 'mobility', 'mean', '%', 'percent', 1, 0, 100, 'Double support time', { hae: 'walking_double_support_percentage' }],
  ['stairUp', Q + 'StairAscentSpeed', 'mobility', 'mean', 'km/hr', 'speed', 2, 0, 20, 'Stair speed: up', { hae: 'stair_speed_up' }],
  ['stairDown', Q + 'StairDescentSpeed', 'mobility', 'mean', 'km/hr', 'speed', 2, 0, 20, 'Stair speed: down', { hae: 'stair_speed_down' }],
  ['sixMinuteWalk', Q + 'SixMinuteWalkTestDistance', 'mobility', 'mean', 'km', 'distance', 2, 0, 2, 'Six-minute walk', { hae: 'six_minute_walking_test_distance' }],
  ['walkingSteadiness', Q + 'AppleWalkingSteadiness', 'mobility', 'mean', '%', 'percent', 0, 0, 100, 'Walking steadiness'],
  ['steadinessEvent', C + 'AppleWalkingSteadinessEvent', 'mobility', 'ev', 'count', 'plain', 0, 0, 100, 'Walking steadiness notifications'],
  ['falls', Q + 'NumberOfTimesFallen', 'mobility', 'sum', 'count', 'plain', 0, 0, 100, 'Falls'],
  // ---- hearing
  ['envAudio', Q + 'EnvironmentalAudioExposure', 'hearing', 'mean', 'dBASPL', 'plain', 0, 0, 150, 'Environmental sound levels', { hae: 'environmental_audio_exposure' }],
  ['headphoneAudio', Q + 'HeadphoneAudioExposure', 'hearing', 'mean', 'dBASPL', 'plain', 0, 0, 150, 'Headphone audio levels', { hae: 'headphone_audio_exposure' }],
  ['soundReduction', Q + 'EnvironmentalSoundReduction', 'hearing', 'mean', 'dBASPL', 'plain', 0, 0, 150, 'Environmental sound reduction'],
  ['envAudioEvent', C + 'EnvironmentalAudioExposureEvent', 'hearing', 'ev', 'count', 'plain', 0, 0, 100, 'Noise notifications'],
  ['headphoneAudioEvent', C + 'HeadphoneAudioExposureEvent', 'hearing', 'ev', 'count', 'plain', 0, 0, 100, 'Headphone notifications'],
  // ---- nutrition: the day's totals
  ['dietEnergy', Q + 'DietaryEnergyConsumed', 'nutrition', 'sum', 'kcal', 'energy', 0, 0, 30000, 'Energy consumed', { hae: 'dietary_energy' }],
  ['dietProtein', Q + 'DietaryProtein', 'nutrition', 'sum', 'g', 'gram', 1, 0, N, 'Dietary protein', { hae: 'protein' }],
  ['dietCarbs', Q + 'DietaryCarbohydrates', 'nutrition', 'sum', 'g', 'gram', 1, 0, N, 'Carbohydrates', { hae: 'carbohydrates' }],
  ['dietFat', Q + 'DietaryFatTotal', 'nutrition', 'sum', 'g', 'gram', 1, 0, N, 'Total fat', { hae: 'total_fat' }],
  ['dietSatFat', Q + 'DietaryFatSaturated', 'nutrition', 'sum', 'g', 'gram', 1, 0, N, 'Saturated fat', { hae: 'saturated_fat' }],
  ['dietMonoFat', Q + 'DietaryFatMonounsaturated', 'nutrition', 'sum', 'g', 'gram', 1, 0, N, 'Monounsaturated fat', { hae: 'monounsaturated_fat' }],
  ['dietPolyFat', Q + 'DietaryFatPolyunsaturated', 'nutrition', 'sum', 'g', 'gram', 1, 0, N, 'Polyunsaturated fat', { hae: 'polyunsaturated_fat' }],
  ['dietSugar', Q + 'DietarySugar', 'nutrition', 'sum', 'g', 'gram', 1, 0, N, 'Sugar', { hae: 'dietary_sugar' }],
  ['dietFiber', Q + 'DietaryFiber', 'nutrition', 'sum', 'g', 'gram', 1, 0, N, 'Fiber', { hae: 'fiber' }],
  ['dietCholesterol', Q + 'DietaryCholesterol', 'nutrition', 'sum', 'mg', 'gram', 0, 0, N, 'Cholesterol', { hae: 'cholesterol' }],
  ['dietSodium', Q + 'DietarySodium', 'nutrition', 'sum', 'mg', 'gram', 0, 0, N, 'Sodium', { hae: 'sodium' }],
  ['dietWater', Q + 'DietaryWater', 'nutrition', 'sum', 'mL', 'volume', 0, 0, 30000, 'Water', { hae: 'dietary_water' }],
  ['dietCaffeine', Q + 'DietaryCaffeine', 'nutrition', 'sum', 'mg', 'gram', 0, 0, N, 'Caffeine', { hae: 'dietary_caffeine' }],
  ['alcoholicDrinks', Q + 'NumberOfAlcoholicBeverages', 'nutrition', 'sum', 'count', 'plain', 0, 0, 100, 'Alcoholic drinks'],
  ['vitaminA', Q + 'DietaryVitaminA', 'nutrition', 'sum', 'mcg', 'gram', 0, 0, N, 'Vitamin A'],
  ['vitaminB6', Q + 'DietaryVitaminB6', 'nutrition', 'sum', 'mg', 'gram', 1, 0, N, 'Vitamin B6'],
  ['vitaminB12', Q + 'DietaryVitaminB12', 'nutrition', 'sum', 'mcg', 'gram', 1, 0, N, 'Vitamin B12'],
  ['vitaminC', Q + 'DietaryVitaminC', 'nutrition', 'sum', 'mg', 'gram', 0, 0, N, 'Vitamin C'],
  ['vitaminD', Q + 'DietaryVitaminD', 'nutrition', 'sum', 'mcg', 'gram', 1, 0, N, 'Vitamin D'],
  ['vitaminE', Q + 'DietaryVitaminE', 'nutrition', 'sum', 'mg', 'gram', 1, 0, N, 'Vitamin E'],
  ['vitaminK', Q + 'DietaryVitaminK', 'nutrition', 'sum', 'mcg', 'gram', 0, 0, N, 'Vitamin K'],
  ['thiamin', Q + 'DietaryThiamin', 'nutrition', 'sum', 'mg', 'gram', 1, 0, N, 'Thiamin'],
  ['riboflavin', Q + 'DietaryRiboflavin', 'nutrition', 'sum', 'mg', 'gram', 1, 0, N, 'Riboflavin'],
  ['niacin', Q + 'DietaryNiacin', 'nutrition', 'sum', 'mg', 'gram', 1, 0, N, 'Niacin'],
  ['folate', Q + 'DietaryFolate', 'nutrition', 'sum', 'mcg', 'gram', 0, 0, N, 'Folate'],
  ['biotin', Q + 'DietaryBiotin', 'nutrition', 'sum', 'mcg', 'gram', 0, 0, N, 'Biotin'],
  ['pantothenicAcid', Q + 'DietaryPantothenicAcid', 'nutrition', 'sum', 'mg', 'gram', 1, 0, N, 'Pantothenic acid'],
  ['calcium', Q + 'DietaryCalcium', 'nutrition', 'sum', 'mg', 'gram', 0, 0, N, 'Calcium'],
  ['iron', Q + 'DietaryIron', 'nutrition', 'sum', 'mg', 'gram', 1, 0, N, 'Iron'],
  ['phosphorus', Q + 'DietaryPhosphorus', 'nutrition', 'sum', 'mg', 'gram', 0, 0, N, 'Phosphorus'],
  ['iodine', Q + 'DietaryIodine', 'nutrition', 'sum', 'mcg', 'gram', 0, 0, N, 'Iodine'],
  ['magnesium', Q + 'DietaryMagnesium', 'nutrition', 'sum', 'mg', 'gram', 0, 0, N, 'Magnesium'],
  ['zinc', Q + 'DietaryZinc', 'nutrition', 'sum', 'mg', 'gram', 1, 0, N, 'Zinc'],
  ['selenium', Q + 'DietarySelenium', 'nutrition', 'sum', 'mcg', 'gram', 0, 0, N, 'Selenium'],
  ['copper', Q + 'DietaryCopper', 'nutrition', 'sum', 'mg', 'gram', 2, 0, N, 'Copper'],
  ['manganese', Q + 'DietaryManganese', 'nutrition', 'sum', 'mg', 'gram', 1, 0, N, 'Manganese'],
  ['chromium', Q + 'DietaryChromium', 'nutrition', 'sum', 'mcg', 'gram', 0, 0, N, 'Chromium'],
  ['molybdenum', Q + 'DietaryMolybdenum', 'nutrition', 'sum', 'mcg', 'gram', 0, 0, N, 'Molybdenum'],
  ['chloride', Q + 'DietaryChloride', 'nutrition', 'sum', 'mg', 'gram', 0, 0, N, 'Chloride'],
  ['potassium', Q + 'DietaryPotassium', 'nutrition', 'sum', 'mg', 'gram', 0, 0, N, 'Potassium'],
  // ---- cycle tracking
  ['menstrualFlow', C + 'MenstrualFlow', 'cycle', 'lvl', '', 'plain', 0, 1, 4, 'Menstrual flow', { cat: 'flow' }],
  ['spotting', C + 'IntermenstrualBleeding', 'cycle', 'ev', 'count', 'plain', 0, 0, 100, 'Spotting'],
  ['basalTemperature', Q + 'BasalBodyTemperature', 'cycle', 'mean', 'degC', 'temp', 2, 30, 45, 'Basal body temperature', { hae: 'basal_body_temperature' }],
  ['ovulationTest', C + 'OvulationTestResult', 'cycle', 'val', '', 'plain', 0, 1, 4, 'Ovulation test', { cat: 'ovulation' }],
  ['cervicalMucus', C + 'CervicalMucusQuality', 'cycle', 'val', '', 'plain', 0, 1, 5, 'Cervical mucus', { cat: 'mucus' }],
  ['pregnancyTest', C + 'PregnancyTestResult', 'cycle', 'val', '', 'plain', 0, 1, 3, 'Pregnancy test', { cat: 'test' }],
  ['progesteroneTest', C + 'ProgesteroneTestResult', 'cycle', 'val', '', 'plain', 0, 1, 3, 'Progesterone test', { cat: 'test' }],
  ['contraceptive', C + 'Contraceptive', 'cycle', 'val', '', 'plain', 0, 1, 7, 'Contraceptive', { cat: 'contraceptive' }],
  ['sexualActivity', C + 'SexualActivity', 'cycle', 'ev', 'count', 'plain', 0, 0, 100, 'Sexual activity'],
  ['pregnancy', C + 'Pregnancy', 'cycle', 'ev', 'count', 'plain', 0, 0, 100, 'Pregnancy'],
  ['lactation', C + 'Lactation', 'cycle', 'ev', 'count', 'plain', 0, 0, 100, 'Lactation'],
  ['infrequentCycles', C + 'InfrequentMenstrualCycles', 'cycle', 'ev', 'count', 'plain', 0, 0, 100, 'Infrequent periods'],
  ['irregularCycles', C + 'IrregularMenstrualCycles', 'cycle', 'ev', 'count', 'plain', 0, 0, 100, 'Irregular cycles'],
  ['persistentSpotting', C + 'PersistentIntermenstrualBleeding', 'cycle', 'ev', 'count', 'plain', 0, 0, 100, 'Persistent spotting'],
  ['prolongedPeriods', C + 'ProlongedMenstrualPeriods', 'cycle', 'ev', 'count', 'plain', 0, 0, 100, 'Prolonged periods'],
  // ---- mindfulness and habits
  ['mindful', C + 'MindfulSession', 'mindfulness', 'min', 'min', 'time', 0, 0, 1440, 'Mindful minutes', { hae: 'mindful_minutes' }],
  ['handwashing', C + 'HandwashingEvent', 'mindfulness', 'ev', 'count', 'plain', 0, 0, 500, 'Handwashing'],
  ['toothbrushing', C + 'ToothbrushingEvent', 'mindfulness', 'ev', 'count', 'plain', 0, 0, 100, 'Toothbrushing'],
];

// Symptoms: one per type, each the day's worst severity ("present" when the phone gave none).
const SYMPTOMS = [
  ['abdominalCramps', 'AbdominalCramps', 'Abdominal cramps'], ['acne', 'Acne', 'Acne'],
  ['appetiteChanges', 'AppetiteChanges', 'Appetite changes', 'appetite'], ['bladderIncontinence', 'BladderIncontinence', 'Bladder incontinence'],
  ['bloating', 'Bloating', 'Bloating'], ['breastPain', 'BreastPain', 'Breast pain'],
  ['chestPain', 'ChestTightnessOrPain', 'Chest tightness or pain'], ['chills', 'Chills', 'Chills'],
  ['constipation', 'Constipation', 'Constipation'], ['coughing', 'Coughing', 'Coughing'],
  ['diarrhea', 'Diarrhea', 'Diarrhea'], ['dizziness', 'Dizziness', 'Dizziness'],
  ['drySkin', 'DrySkin', 'Dry skin'], ['fainting', 'Fainting', 'Fainting'],
  ['fatigue', 'Fatigue', 'Fatigue'], ['fever', 'Fever', 'Fever'],
  ['bodyAche', 'GeneralizedBodyAche', 'Body and muscle ache'], ['hairLoss', 'HairLoss', 'Hair loss'],
  ['headache', 'Headache', 'Headache'], ['heartburn', 'Heartburn', 'Heartburn'],
  ['hotFlashes', 'HotFlashes', 'Hot flashes'], ['lossOfSmell', 'LossOfSmell', 'Loss of smell'],
  ['lossOfTaste', 'LossOfTaste', 'Loss of taste'], ['lowerBackPain', 'LowerBackPain', 'Lower back pain'],
  ['memoryLapse', 'MemoryLapse', 'Memory lapse'], ['moodChanges', 'MoodChanges', 'Mood changes', 'presence'],
  ['nausea', 'Nausea', 'Nausea'], ['nightSweats', 'NightSweats', 'Night sweats'],
  ['pelvicPain', 'PelvicPain', 'Pelvic pain'], ['palpitations', 'RapidPoundingOrFlutteringHeartbeat', 'Rapid, pounding or fluttering heartbeat'],
  ['runnyNose', 'RunnyNose', 'Runny nose'], ['shortnessOfBreath', 'ShortnessOfBreath', 'Shortness of breath'],
  ['sinusCongestion', 'SinusCongestion', 'Sinus congestion'], ['skippedHeartbeat', 'SkippedHeartbeat', 'Skipped heartbeat'],
  ['sleepChanges', 'SleepChanges', 'Sleep changes', 'presence'], ['soreThroat', 'SoreThroat', 'Sore throat'],
  ['vaginalDryness', 'VaginalDryness', 'Vaginal dryness'], ['vomiting', 'Vomiting', 'Vomiting'],
  ['wheezing', 'Wheezing', 'Wheezing'],
];
for (const [type, id, label, cat = 'severity'] of SYMPTOMS) ROWS.push([type, C + id, 'symptoms', 'lvl', '', 'plain', 0, 1, 4, label, { cat }]);

// A workout: its minutes, with the activity (WORKOUTS), its energy and distance alongside.
export const WORKOUT = 'workout';
ROWS.push([WORKOUT, 'HKWorkoutTypeIdentifier', 'workouts', 'wo', 'min', 'time', 0, 0, 2880, 'Workouts', CORE]);

export const TYPES = {};
for (const [type, hk, group, kind, unit, dim, dec, min, max, label, extra = {}] of ROWS) {
  TYPES[type] = { type, hk, group, kind, unit, dim, dec, min, max, label, ...extra };
}
export const BY_HK = Object.fromEntries(Object.values(TYPES).map(x => [x.hk, x.type]));
export const typeOf = type => TYPES[type] || null;

/* ---------- units ---------- */

// Per dim: each unit's size in the dim's base unit. A value's unit is matched as given, then
// without case ('Cal' — a kilocalorie — and 'cal' are told apart by their case alone).
const DIMS = {
  mass: { kg: 1, g: 1e-3, lb: 0.45359237, lbs: 0.45359237, st: 6.35029318, oz: 0.028349523125 },
  gram: { g: 1, mg: 1e-3, mcg: 1e-6, 'µg': 1e-6, ug: 1e-6, kg: 1e3, oz: 28.349523125, lb: 453.59237 },
  length: { cm: 1, mm: 0.1, m: 100, km: 1e5, in: 2.54, ft: 30.48 },
  distance: { km: 1, m: 1e-3, cm: 1e-5, mi: 1.609344, yd: 0.0009144, ft: 0.0003048 },
  speed: { 'km/hr': 1, 'km/h': 1, 'm/s': 3.6, 'mi/hr': 1.609344, mph: 1.609344, 'ft/s': 1.09728 },
  energy: { kcal: 1, Cal: 1, kJ: 1 / 4.184, cal: 1e-3, J: 1 / 4184 },
  time: { s: 1, ms: 1e-3, min: 60, hr: 3600, h: 3600, d: 86400 },
  volume: { mL: 1, L: 1e3, dL: 100, cL: 10, fl_oz_us: 29.5735295625, fl_oz: 29.5735295625, 'fl oz': 29.5735295625, cup_us: 236.5882365 },
  volumeL: { L: 1, mL: 1e-3, dL: 0.1 },
  glucose: { 'mg/dL': 1, 'mmol/L': 18.0156, 'mmol<180.1558800000541>/L': 18.0156 },
};
const factor = (table, u) => {
  if (u in table) return table[u];
  const low = u.toLowerCase();
  for (const k of Object.keys(table)) if (k.toLowerCase() === low && k !== 'Cal' && k !== 'cal') return table[k];
  return null;
};

/** A value in `unit` as the type's canonical number (an unknown or missing unit: as it is). */
export function canonical(type, v, unit = '') {
  const t = TYPES[type];
  const n = Number(v);
  if (!t || !Number.isFinite(n)) return n;
  const u = String(unit || '').trim();
  if (t.dim === 'percent') return u === '%' || !u ? (n <= 1 ? n * 100 : n) : n;
  if (t.dim === 'temp') return /^deg ?F$|^°?F$/i.test(u) ? (n - 32) * 5 / 9 : /^K$/.test(u) ? n - 273.15 : n;
  const table = DIMS[t.dim];
  if (!table || !u) return n;
  const from = factor(table, u), to = factor(table, t.unit);
  return from == null || to == null ? n : n * from / to;
}

/* ---------- category values ---------- */

// Each family's raw values (HealthKit's own numbers, which the export writes as names) and what is
// kept: a level or an answer from 1 up; a value missing here is "nothing to record" (not present,
// no flow, idle).
const ENUMS = {
  Severity: { Unspecified: 0, NotPresent: 1, Mild: 2, Moderate: 3, Severe: 4 },
  Presence: { Present: 0, NotPresent: 1 },
  AppetiteChanges: { Unspecified: 0, NoChange: 1, Decreased: 2, Increased: 3 },
  MenstrualFlow: { Unspecified: 1, Light: 2, Medium: 3, Heavy: 4, None: 5 },
  OvulationTestResult: { Negative: 1, LuteinizingHormoneSurge: 2, Positive: 2, Indeterminate: 3, EstrogenSurge: 4 },
  CervicalMucusQuality: { Dry: 1, Sticky: 2, Creamy: 3, Watery: 4, EggWhite: 5 },
  PregnancyTestResult: { Negative: 1, Positive: 2, Indeterminate: 3 },
  ProgesteroneTestResult: { Negative: 1, Positive: 2, Indeterminate: 3 },
  Contraceptive: { Unspecified: 1, Implant: 2, Injection: 3, IntrauterineDevice: 4, IntravaginalRing: 5, Oral: 6, Patch: 7 },
  AppleStandHour: { Stood: 0, Idle: 1 },
};
const CATS = {
  severity: { 0: 1, 2: 2, 3: 3, 4: 4 },
  presence: { 0: 1 },
  appetite: { 0: 1, 2: 1, 3: 1 },
  flow: { 1: 1, 2: 2, 3: 3, 4: 4 },
  ovulation: { 1: 1, 2: 2, 3: 3, 4: 4 },
  mucus: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 },
  test: { 1: 1, 2: 2, 3: 3 },
  contraceptive: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 },
  stand: { 0: 1 },
};
// What a kept level or answer reads as on screen (keys for the app's translations), by family.
export const LEVELS = {
  severity: ['', 'Present', 'Mild', 'Moderate', 'Severe'],
  presence: ['', 'Present'],
  appetite: ['', 'Present'],
  flow: ['', 'Flow', 'Light flow', 'Medium flow', 'Heavy flow'],
  ovulation: ['', 'Negative', 'LH surge', 'Indeterminate', 'Estrogen surge'],
  mucus: ['', 'Dry', 'Sticky', 'Creamy', 'Watery', 'Egg white'],
  test: ['', 'Negative', 'Positive', 'Indeterminate'],
  contraceptive: ['', 'Contraceptive', 'Implant', 'Injection', 'IUD', 'Vaginal ring', 'Pill', 'Patch'],
};

/**
 * A category sample's value as what is kept for `type`: a number from 1 up, or null for nothing
 * to record. `raw` is HealthKit's number or the export's name of it
 * ("HKCategoryValueSeverityMild"); a type without a family (a notification, a mindful session)
 * counts every sample.
 */
export function categoryValue(type, raw) {
  const t = TYPES[type];
  if (!t) return null;
  if (!t.cat) return 1;
  let n = Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(n)) {
    const m = /^HKCategoryValue(Severity|Presence|AppetiteChanges|MenstrualFlow|OvulationTestResult|CervicalMucusQuality|PregnancyTestResult|ProgesteroneTestResult|Contraceptive|AppleStandHour)(\w+)$/.exec(String(raw || ''));
    n = m ? ENUMS[m[1]][m[2]] : NaN;
    if (!Number.isFinite(n)) return null;
  }
  const kept = CATS[t.cat][n];
  return kept == null ? null : kept;
}

/* ---------- workouts ---------- */

// HealthKit's activity types by their raw number; the export writes "HKWorkoutActivityType" and
// the name. The key is kept on the reading (`a`), the label shown.
export const WORKOUTS = {
  1: ['americanFootball', 'American football'], 2: ['archery', 'Archery'], 3: ['australianFootball', 'Australian football'],
  4: ['badminton', 'Badminton'], 5: ['baseball', 'Baseball'], 6: ['basketball', 'Basketball'], 7: ['bowling', 'Bowling'],
  8: ['boxing', 'Boxing'], 9: ['climbing', 'Climbing'], 10: ['cricket', 'Cricket'], 11: ['crossTraining', 'Cross training'],
  12: ['curling', 'Curling'], 13: ['cycling', 'Cycling'], 14: ['dance', 'Dance'], 15: ['danceInspiredTraining', 'Dance'],
  16: ['elliptical', 'Elliptical'], 17: ['equestrianSports', 'Equestrian sports'], 18: ['fencing', 'Fencing'],
  19: ['fishing', 'Fishing'], 20: ['functionalStrengthTraining', 'Functional strength training'], 21: ['golf', 'Golf'],
  22: ['gymnastics', 'Gymnastics'], 23: ['handball', 'Handball'], 24: ['hiking', 'Hiking'], 25: ['hockey', 'Hockey'],
  26: ['hunting', 'Hunting'], 27: ['lacrosse', 'Lacrosse'], 28: ['martialArts', 'Martial arts'], 29: ['mindAndBody', 'Mind and body'],
  30: ['mixedMetabolicCardioTraining', 'Mixed cardio'], 31: ['paddleSports', 'Paddle sports'], 32: ['play', 'Play'],
  33: ['preparationAndRecovery', 'Preparation and recovery'], 34: ['racquetball', 'Racquetball'], 35: ['rowing', 'Rowing'],
  36: ['rugby', 'Rugby'], 37: ['running', 'Running'], 38: ['sailing', 'Sailing'], 39: ['skatingSports', 'Skating'],
  40: ['snowSports', 'Snow sports'], 41: ['soccer', 'Soccer'], 42: ['softball', 'Softball'], 43: ['squash', 'Squash'],
  44: ['stairClimbing', 'Stair climbing'], 45: ['surfingSports', 'Surfing'], 46: ['swimming', 'Swimming'],
  47: ['tableTennis', 'Table tennis'], 48: ['tennis', 'Tennis'], 49: ['trackAndField', 'Track and field'],
  50: ['traditionalStrengthTraining', 'Traditional strength training'], 51: ['volleyball', 'Volleyball'], 52: ['walking', 'Walking'],
  53: ['waterFitness', 'Water fitness'], 54: ['waterPolo', 'Water polo'], 55: ['waterSports', 'Water sports'],
  56: ['wrestling', 'Wrestling'], 57: ['yoga', 'Yoga'], 58: ['barre', 'Barre'], 59: ['coreTraining', 'Core training'],
  60: ['crossCountrySkiing', 'Cross-country skiing'], 61: ['downhillSkiing', 'Downhill skiing'], 62: ['flexibility', 'Flexibility'],
  63: ['highIntensityIntervalTraining', 'HIIT'], 64: ['jumpRope', 'Jump rope'], 65: ['kickboxing', 'Kickboxing'],
  66: ['pilates', 'Pilates'], 67: ['snowboarding', 'Snowboarding'], 68: ['stairs', 'Stairs'], 69: ['stepTraining', 'Step training'],
  70: ['wheelchairWalkPace', 'Wheelchair walk pace'], 71: ['wheelchairRunPace', 'Wheelchair run pace'], 72: ['taiChi', 'Tai chi'],
  73: ['mixedCardio', 'Mixed cardio'], 74: ['handCycling', 'Hand cycling'], 75: ['discSports', 'Disc sports'],
  76: ['fitnessGaming', 'Fitness gaming'], 77: ['cardioDance', 'Cardio dance'], 78: ['socialDance', 'Social dance'],
  79: ['pickleball', 'Pickleball'], 80: ['cooldown', 'Cooldown'], 82: ['swimBikeRun', 'Multisport'], 83: ['transition', 'Transition'],
  84: ['underwaterDiving', 'Underwater diving'], 3000: ['other', 'Other'],
};
const WORKOUT_KEYS = {};
for (const [key, label] of Object.values(WORKOUTS)) {
  WORKOUT_KEYS[key.toLowerCase()] = key;
  WORKOUT_KEYS[label.toLowerCase().replace(/[^a-z]/g, '')] = key;
}
/** The label of an activity key (an unknown one is "Other"). */
export const workoutLabel = key => Object.values(WORKOUTS).find(([k]) => k === key)?.[1] || 'Other';
/**
 * An activity as its key: HealthKit's number, the export's "HKWorkoutActivityTypeRunning", or a
 * name such as Health Auto Export's ("Outdoor Run", "Traditional Strength Training").
 */
export function workoutKey(raw) {
  if (raw == null || raw === '') return 'other';
  const n = Number(raw);
  if (Number.isFinite(n)) return WORKOUTS[n]?.[0] || 'other';
  const s = String(raw).replace(/^HKWorkoutActivityType/, '');
  const flat = s.toLowerCase().replace(/[^a-z]/g, '');
  if (WORKOUT_KEYS[flat]) return WORKOUT_KEYS[flat];
  const rest = flat.replace(/^(outdoor|indoor|pool|openwater)/, '');
  if (WORKOUT_KEYS[rest]) return WORKOUT_KEYS[rest];
  if (rest === 'run') return 'running';
  if (rest === 'walk') return 'walking';
  if (rest === 'cycle' || rest === 'bike') return 'cycling';
  if (rest === 'swim') return 'swimming';
  return 'other';
}

/* ---------- keeping the profile small ---------- */

// The fields a reading may carry beside its value: a day's lowest and highest (lo, hi), a
// workout's activity, energy and distance (a, kc, km).
export const EXTRA_FIELDS = ['lo', 'hi', 'a', 'kc', 'km'];

// How many imported readings a profile keeps. The whole profile is one document: the browser holds
// it in localStorage and the server takes 5 MB a push, so years of a hundred kinds of reading
// cannot all stay. Past this many, the oldest readings of the other kinds go first and the core
// ones (weight, body composition, steps, distance, energy, heart rate, sleep, workouts) last;
// what the user typed is never counted or dropped.
export const MAX_IMPORTED = 12000;

/**
 * Health records within MAX_IMPORTED: the input if it fits, otherwise a new list without the
 * oldest imported readings — the same records whichever device or server runs it, so every copy
 * of a profile settles on the same set.
 */
export function trimImported(health, max = MAX_IMPORTED) {
  if (!Array.isArray(health)) return health;
  const imported = health.filter(r => r && r.src && r.src !== 'manual');
  if (imported.length <= max) return health;
  const core = r => (TYPES[r.type] && TYPES[r.type].core ? 1 : 0);
  const order = imported.slice().sort((a, b) => core(a) - core(b) || (Number(a.t) || 0) - (Number(b.t) || 0) || (String(a.id) < String(b.id) ? -1 : 1));
  const drop = new Set(order.slice(0, imported.length - max));
  return health.filter(r => !drop.has(r));
}
