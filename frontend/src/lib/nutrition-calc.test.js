import { describe, it, expect } from 'vitest';
import {
  calculateBMR,
  calculateTDEE,
  validateCalorieSafety,
  calculatePersonalizedTargets,
  aggregateDailyNutrients,
  calculateDailyProgress
} from './nutrition-calc.js';
import {
  PAKISTANI_FOODS,
  PAKISTANI_FOOD_CATEGORIES,
  searchPakistaniFoods,
  getPakistaniFoodById,
  calculateServingNutrients
} from './pakistani-foods-data.js';

describe('Pakistani Foods Database', () => {
  it('contains > 500 authentic food items', () => {
    expect(PAKISTANI_FOODS.length).toBeGreaterThan(500);
  });

  it('contains 16 comprehensive Pakistani culinary categories', () => {
    expect(PAKISTANI_FOOD_CATEGORIES.length).toBe(16);
  });

  it('every food item has valid per-100g nutritional profile', () => {
    for (const food of PAKISTANI_FOODS) {
      expect(food.id).toBeDefined();
      expect(food.name).toBeDefined();
      expect(food.category).toBeDefined();
      expect(food.per100g).toBeDefined();
      expect(food.per100g.calories).toBeGreaterThanOrEqual(0);
      expect(food.per100g.protein).toBeGreaterThanOrEqual(0);
      expect(food.per100g.carbs).toBeGreaterThanOrEqual(0);
      expect(food.per100g.fat).toBeGreaterThanOrEqual(0);
      expect(food.per100g.fiber).toBeGreaterThanOrEqual(0);
      expect(food.per100g.sugar).toBeGreaterThanOrEqual(0);
    }
  });

  it('searches foods by English name, Urdu, and category', () => {
    const karahiResults = searchPakistaniFoods('karahi');
    expect(karahiResults.length).toBeGreaterThan(0);

    const urduResults = searchPakistaniFoods('بریانی');
    expect(urduResults.length).toBeGreaterThan(0);

    const categoryResults = searchPakistaniFoods('', 'Rice & Biryani');
    expect(categoryResults.length).toBeGreaterThanOrEqual(30);
  });

  it('calculates serving nutrients accurately', () => {
    const chapati = PAKISTANI_FOODS.find(f => f.name.includes('Tawa Chapati'));
    expect(chapati).toBeDefined();

    // 1 roti is ~45g
    const oneRoti = calculateServingNutrients(chapati, 1, 'roti');
    expect(oneRoti.grams).toBe(45);
    expect(oneRoti.calories).toBeCloseTo((chapati.per100g.calories * 0.45), 1);

    // 200g entry
    const twoHundredGrams = calculateServingNutrients(chapati, 200, 'g');
    expect(twoHundredGrams.grams).toBe(200);
    expect(twoHundredGrams.calories).toBe(Math.round(chapati.per100g.calories * 2 * 10) / 10);
  });
});

describe('Nutrition Calculation Engine', () => {
  it('calculates Mifflin-St Jeor BMR correctly for male and female', () => {
    // 70kg, 175cm, 25 years old
    // Male: 10*70 + 6.25*175 - 5*25 + 5 = 700 + 1093.75 - 125 + 5 = 1673.75 -> 1674
    const maleBMR = calculateBMR({ weight: 70, height: 175, age: 25, gender: 'male' });
    expect(maleBMR).toBe(1674);

    // Female: 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25 -> 1345
    const femaleBMR = calculateBMR({ weight: 60, height: 165, age: 25, gender: 'female' });
    expect(femaleBMR).toBe(1345);
  });

  it('calculates TDEE using correct activity multipliers', () => {
    const bmr = 1674;
    expect(calculateTDEE(bmr, 'sedentary')).toBe(Math.round(bmr * 1.2));
    expect(calculateTDEE(bmr, 'moderate')).toBe(Math.round(bmr * 1.55));
    expect(calculateTDEE(bmr, 'very_active')).toBe(Math.round(bmr * 1.725));
  });

  it('warns against unsafe crash diets and excessive deficits', () => {
    const tdee = 2000;
    // Deficit of 1200 kcal is excessive (>1000 and >30%)
    const safety = validateCalorieSafety(tdee, -1200, 'male', 1500);
    expect(safety.warnings.length).toBeGreaterThan(0);
    expect(safety.isUnsafe).toBe(true); // target 800 < 1500 min floor for male
  });

  it('calculates personalized macro distributions', () => {
    const targets = calculatePersonalizedTargets({
      age: 26,
      gender: 'male',
      height: 178,
      weight: 80,
      targetWeight: 75,
      activityLevel: 'moderate',
      objective: 'fat_loss'
    });

    expect(targets.targetCalories).toBeGreaterThan(1500);
    expect(targets.targetProtein).toBeGreaterThanOrEqual(160); // 2.0g/kg for fat loss
    expect(targets.targetCarbs).toBeGreaterThan(50);
    expect(targets.targetFat).toBeGreaterThan(30);
    expect(targets.targetFiber).toBeGreaterThanOrEqual(25);
    expect(targets.targetWaterMl).toBe(80 * 35);
  });

  it('aggregates daily logged foods and calculates progress correctly', () => {
    const entries = [
      {
        id: 'log_1',
        nutrients: {
          calories: 500,
          protein: 40,
          carbs: 50,
          fat: 15,
          fiber: 8,
          calcium: 200,
          iron: 4
        }
      },
      {
        id: 'log_2',
        nutrients: {
          calories: 300,
          protein: 20,
          carbs: 35,
          fat: 10,
          fiber: 5,
          calcium: 150,
          iron: 2
        }
      }
    ];

    const totals = aggregateDailyNutrients(entries);
    expect(totals.calories).toBe(800);
    expect(totals.protein).toBe(60);
    expect(totals.carbs).toBe(85);
    expect(totals.fat).toBe(25);
    expect(totals.fiber).toBe(13);
    expect(totals.calcium).toBe(350);
    expect(totals.iron).toBe(6);

    const progress = calculateDailyProgress(totals, {
      targetCalories: 2000,
      targetProtein: 150,
      targetCarbs: 220,
      targetFat: 60,
      targetFiber: 30
    });

    expect(progress.calories.consumed).toBe(800);
    expect(progress.calories.remaining).toBe(1200);
    expect(progress.calories.percent).toBe(40);
  });
});
