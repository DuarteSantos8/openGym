/**
 * FreeFit Nutrition Calculation Engine
 * 
 * Provides verified metabolic calculations:
 * - Mifflin-St Jeor Basal Metabolic Rate (BMR)
 * - Total Daily Energy Expenditure (TDEE)
 * - Objective-based calorie adjustments (Deficit / Surplus / Maintenance)
 * - Personalized Macronutrient & Micronutrient targets
 * - Safety checks & boundary validation (preventing unsafe crash diets)
 * - Daily nutrient aggregator & balance calculator
 */

export const FITNESS_OBJECTIVES = [
  { id: 'fat_loss', label: 'Fat Loss', defaultAdjustment: -500, desc: 'Gradual body fat reduction preserving lean muscle.' },
  { id: 'weight_loss', label: 'Weight Loss', defaultAdjustment: -400, desc: 'Steady, sustainable weight loss.' },
  { id: 'muscle_gain', label: 'Muscle Gain (Lean Bulk)', defaultAdjustment: 300, desc: 'Controlled surplus to maximize muscle hypertrophy.' },
  { id: 'weight_gain', label: 'Weight Gain', defaultAdjustment: 500, desc: 'Healthy calorie surplus for mass and recovery.' },
  { id: 'fat_gain', label: 'Fat Gain (Underweight Recovery)', defaultAdjustment: 600, desc: 'Nutritional recovery for underweight individuals.' },
  { id: 'maintenance', label: 'Weight Maintenance', defaultAdjustment: 0, desc: 'Maintain current body weight and metabolic equilibrium.' },
  { id: 'recomposition', label: 'Body Recomposition', defaultAdjustment: -150, desc: 'Simultaneous fat loss and muscle building with high protein.' }
];

export const ACTIVITY_LEVELS = [
  { id: 'sedentary', label: 'Sedentary', multiplier: 1.2, desc: 'Little to no regular exercise, desk job.' },
  { id: 'light', label: 'Lightly Active', multiplier: 1.375, desc: 'Light exercise or sports 1–3 days/week.' },
  { id: 'moderate', label: 'Moderately Active', multiplier: 1.55, desc: 'Moderate exercise or sports 3–5 days/week.' },
  { id: 'very_active', label: 'Very Active', multiplier: 1.725, desc: 'Hard exercise or sports 6–7 days/week.' },
  { id: 'extra_active', label: 'Extremely Active', multiplier: 1.9, desc: 'Very hard daily training, physical labour or 2x/day.' }
];

export const MEAL_CATEGORIES = [
  { id: 'breakfast', label: 'Breakfast', icon: 'sunrise', time: '08:00 AM' },
  { id: 'midMorning', label: 'Mid-Morning Snack', icon: 'coffee', time: '11:00 AM' },
  { id: 'lunch', label: 'Lunch', icon: 'sun', time: '01:30 PM' },
  { id: 'afternoonSnack', label: 'Afternoon Snack', icon: 'cookie', time: '04:30 PM' },
  { id: 'eveningSnack', label: 'Evening Snack', icon: 'tea', time: '06:30 PM' },
  { id: 'dinner', label: 'Dinner', icon: 'moon', time: '08:30 PM' },
  { id: 'postWorkout', label: 'Post-Workout', icon: 'zap', time: 'Flexible' },
  { id: 'other', label: 'Other / Late Night', icon: 'package', time: 'Flexible' }
];

export const DAILY_MICRONUTRIENT_RDA = {
  sodium: { val: 2300, unit: 'mg', label: 'Sodium' },
  potassium: { val: 3500, unit: 'mg', label: 'Potassium' },
  calcium: { val: 1000, unit: 'mg', label: 'Calcium' },
  iron: { val: 14, unit: 'mg', label: 'Iron' },
  magnesium: { val: 400, unit: 'mg', label: 'Magnesium' },
  zinc: { val: 11, unit: 'mg', label: 'Zinc' },
  omega3: { val: 1.6, unit: 'g', label: 'Omega-3' },
  omega6: { val: 14, unit: 'g', label: 'Omega-6' },
  vitA: { val: 900, unit: 'mcg', label: 'Vitamin A' },
  vitB1: { val: 1.2, unit: 'mg', label: 'Vitamin B1' },
  vitB2: { val: 1.3, unit: 'mg', label: 'Vitamin B2' },
  vitB3: { val: 16, unit: 'mg', label: 'Vitamin B3' },
  vitB6: { val: 1.7, unit: 'mg', label: 'Vitamin B6' },
  vitB12: { val: 2.4, unit: 'mcg', label: 'Vitamin B12' },
  vitC: { val: 90, unit: 'mg', label: 'Vitamin C' },
  vitD: { val: 600, unit: 'IU', label: 'Vitamin D' },
  vitE: { val: 15, unit: 'mg', label: 'Vitamin E' },
  vitK: { val: 120, unit: 'mcg', label: 'Vitamin K' },
  folate: { val: 400, unit: 'mcg', label: 'Folate (B9)' }
};

/**
 * Calculate Basal Metabolic Rate using Mifflin-St Jeor Equation
 * @param {Object} params
 * @param {number} params.weight - Weight in kg
 * @param {number} params.height - Height in cm
 * @param {number} params.age - Age in years
 * @param {'male'|'female'|'other'} params.gender
 * @returns {number} BMR in kcal
 */
export function calculateBMR({ weight, height, age, gender = 'male' }) {
  const w = parseFloat(weight) || 70;
  const h = parseFloat(height) || 170;
  const a = parseFloat(age) || 25;

  let bmr = 10 * w + 6.25 * h - 5 * a;
  if (gender === 'female') {
    bmr -= 161;
  } else {
    // Default male / other
    bmr += 5;
  }
  return Math.round(bmr);
}

/**
 * Calculate Total Daily Energy Expenditure (TDEE)
 * @param {number} bmr
 * @param {string} activityLevelId
 * @returns {number} TDEE in kcal
 */
export function calculateTDEE(bmr, activityLevelId = 'moderate') {
  const act = ACTIVITY_LEVELS.find(a => a.id === activityLevelId) || ACTIVITY_LEVELS[2];
  return Math.round(bmr * act.multiplier);
}

/**
 * Validates calorie adjustments and produces safety status
 * @param {number} tdee
 * @param {number} adjustment - Negative for deficit, positive for surplus
 * @param {string} gender
 * @param {number} bmr
 * @returns {Object} validation result
 */
export function validateCalorieSafety(tdee, adjustment, gender = 'male', bmr = 0) {
  const target = Math.round(tdee + adjustment);
  const minFloor = gender === 'female' ? 1200 : 1500;
  const warnings = [];
  let isUnsafe = false;

  // Check absolute minimum floor
  if (target < minFloor) {
    warnings.push(`Target of ${target} kcal is below recommended physiological minimum (${minFloor} kcal for ${gender}). Eating below this can cause muscle atrophy, nutrient deficiencies, and fatigue.`);
    isUnsafe = true;
  }

  // Check deficit safety
  if (adjustment < 0) {
    const deficitPct = Math.round((Math.abs(adjustment) / tdee) * 100);
    if (Math.abs(adjustment) > 1000 || deficitPct > 30) {
      warnings.push(`A deficit of ${Math.abs(adjustment)} kcal (${deficitPct}% of TDEE) is very aggressive. Rapid crash diets frequently cause rebound weight gain and muscle loss.`);
    }
  }

  // Check surplus safety
  if (adjustment > 800) {
    warnings.push(`A surplus of ${adjustment} kcal is high and may result in unwanted body fat accumulation along with muscle.`);
  }

  return {
    targetCalories: Math.max(1000, target),
    isUnsafe,
    warnings,
    minRecommended: minFloor,
    deficitPct: adjustment < 0 ? Math.round((Math.abs(adjustment) / tdee) * 100) : 0
  };
}

/**
 * Compute comprehensive personalized daily targets
 * @param {Object} profile
 * @returns {Object}
 */
export function calculatePersonalizedTargets(profile) {
  const {
    age = 25,
    gender = 'male',
    height = 175,
    weight = 75,
    targetWeight = 72,
    activityLevel = 'moderate',
    objective = 'weight_loss',
    customCalories = null,
    customDeficit = null,
    customProtein = null,
    customCarbs = null,
    customFat = null,
    customFiber = null
  } = profile;

  const bmr = calculateBMR({ weight, height, age, gender });
  const tdee = calculateTDEE(bmr, activityLevel);

  const objObj = FITNESS_OBJECTIVES.find(o => o.id === objective) || FITNESS_OBJECTIVES[0];
  const adjustment = customDeficit !== null ? parseFloat(customDeficit) : objObj.defaultAdjustment;
  
  const safety = validateCalorieSafety(tdee, adjustment, gender, bmr);
  const dailyCalories = customCalories !== null ? Math.max(1000, parseFloat(customCalories)) : safety.targetCalories;

  // Protein targets based on objective and bodyweight
  let proteinPerKg = 1.6;
  if (objective === 'fat_loss' || objective === 'recomposition') {
    proteinPerKg = 2.0; // Higher protein preserves muscle in a deficit
  } else if (objective === 'muscle_gain') {
    proteinPerKg = 1.9;
  } else if (objective === 'weight_loss') {
    proteinPerKg = 1.8;
  } else {
    proteinPerKg = 1.6;
  }

  let targetProtein = customProtein !== null ? parseFloat(customProtein) : Math.round(weight * proteinPerKg);
  targetProtein = Math.max(40, targetProtein);

  // Fat targets (25% to 30% of total calories, 9 kcal/g)
  let targetFat = customFat !== null ? parseFloat(customFat) : Math.round((dailyCalories * 0.25) / 9);
  targetFat = Math.max(30, targetFat);

  // Remaining calories go to carbohydrates (4 kcal/g)
  const remainingKcalForCarbs = Math.max(0, dailyCalories - (targetProtein * 4) - (targetFat * 9));
  let targetCarbs = customCarbs !== null ? parseFloat(customCarbs) : Math.round(remainingKcalForCarbs / 4);
  targetCarbs = Math.max(30, targetCarbs);

  // Fiber target: 14g per 1000 kcal
  let targetFiber = customFiber !== null ? parseFloat(customFiber) : Math.round((dailyCalories / 1000) * 14);
  targetFiber = Math.max(25, targetFiber);

  // Water intake: ~35ml per kg of bodyweight
  const targetWaterMl = Math.round(weight * 35);

  return {
    bmr,
    tdee,
    adjustment,
    safety,
    targetCalories: dailyCalories,
    targetProtein,
    targetCarbs,
    targetFat,
    targetFiber,
    targetWaterMl,
    macroRatio: {
      proteinPct: Math.round(((targetProtein * 4) / dailyCalories) * 100),
      carbsPct: Math.round(((targetCarbs * 4) / dailyCalories) * 100),
      fatPct: Math.round(((targetFat * 9) / dailyCalories) * 100)
    }
  };
}

/**
 * Aggregate nutrients from an array of logged food entries
 * @param {Array} loggedEntries - List of entries logged for a date
 * @returns {Object} Total consumed nutrients
 */
export function aggregateDailyNutrients(loggedEntries = []) {
  const totals = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    saturatedFat: 0,
    transFat: 0,
    fiber: 0,
    sugar: 0,
    omega3: 0,
    omega6: 0,
    cholesterol: 0,
    sodium: 0,
    potassium: 0,
    calcium: 0,
    iron: 0,
    magnesium: 0,
    zinc: 0,
    vitA: 0,
    vitB1: 0,
    vitB2: 0,
    vitB3: 0,
    vitB6: 0,
    vitB12: 0,
    vitC: 0,
    vitD: 0,
    vitE: 0,
    vitK: 0,
    folate: 0,
    itemCount: loggedEntries.length
  };

  for (const entry of loggedEntries) {
    if (!entry.nutrients) continue;
    const n = entry.nutrients;
    for (const key of Object.keys(totals)) {
      if (key === 'itemCount') continue;
      totals[key] += parseFloat(n[key]) || 0;
    }
  }

  // Round key nutrients cleanly
  for (const key of Object.keys(totals)) {
    if (key === 'itemCount') continue;
    if (['omega3', 'omega6', 'vitB1', 'vitB2', 'vitB6', 'vitB12'].includes(key)) {
      totals[key] = Math.round(totals[key] * 100) / 100;
    } else {
      totals[key] = Math.round(totals[key] * 10) / 10;
    }
  }

  return totals;
}

/**
 * Compute progress and remaining nutrients against user targets
 * @param {Object} totals - Output from aggregateDailyNutrients
 * @param {Object} targets - Target nutrients from profile
 * @returns {Object} Progress stats
 */
export function calculateDailyProgress(totals, targets) {
  const calTarget = targets.targetCalories || 2000;
  const pTarget = targets.targetProtein || 140;
  const cTarget = targets.targetCarbs || 220;
  const fTarget = targets.targetFat || 60;
  const fibTarget = targets.targetFiber || 30;

  return {
    calories: {
      target: calTarget,
      consumed: totals.calories,
      remaining: Math.round((calTarget - totals.calories) * 10) / 10,
      percent: Math.min(100, Math.round((totals.calories / calTarget) * 100))
    },
    protein: {
      target: pTarget,
      consumed: totals.protein,
      remaining: Math.max(0, Math.round((pTarget - totals.protein) * 10) / 10),
      percent: Math.min(100, Math.round((totals.protein / pTarget) * 100))
    },
    carbs: {
      target: cTarget,
      consumed: totals.carbs,
      remaining: Math.max(0, Math.round((cTarget - totals.carbs) * 10) / 10),
      percent: Math.min(100, Math.round((totals.carbs / cTarget) * 100))
    },
    fat: {
      target: fTarget,
      consumed: totals.fat,
      remaining: Math.max(0, Math.round((fTarget - totals.fat) * 10) / 10),
      percent: Math.min(100, Math.round((totals.fat / fTarget) * 100))
    },
    fiber: {
      target: fibTarget,
      consumed: totals.fiber,
      remaining: Math.max(0, Math.round((fibTarget - totals.fiber) * 10) / 10),
      percent: Math.min(100, Math.round((totals.fiber / fibTarget) * 100))
    }
  };
}
