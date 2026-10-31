// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './useStore.js';
import { calculateServingNutrients, getPakistaniFoodById } from '../lib/pakistani-foods-data.js';

describe('Zustand Nutrition Store Integration', () => {
  beforeEach(() => {
    // Reset nutrition state in store
    useStore.getState().update(S => {
      S.nutrition = {
        profile: null,
        logs: {},
        customFoods: [],
        favorites: [],
        recents: []
      };
    });
  });

  it('sets and persists nutrition profile', () => {
    const profileData = {
      age: 26,
      gender: 'male',
      height: 178,
      weight: 78,
      targetWeight: 74,
      activityLevel: 'moderate',
      objective: 'fat_loss',
      bmr: 1740,
      tdee: 2697,
      customDeficit: -500
    };

    useStore.getState().setNutritionProfile(profileData);
    const S = useStore.getState().S;
    expect(S.nutrition.profile).toBeDefined();
    expect(S.nutrition.profile.age).toBe(26);
    expect(S.nutrition.profile.objective).toBe('fat_loss');
  });

  it('logs a Pakistani food item to a specific date and updates recents', () => {
    const food = getPakistaniFoodById('pk_001'); // Tawa Chapati
    expect(food).toBeDefined();

    const nutrients = calculateServingNutrients(food, 2, 'roti'); // 2 rotis
    const logDate = '2026-10-31';

    useStore.getState().logFoodEntry({
      date: logDate,
      meal: 'breakfast',
      foodId: food.id,
      name: food.name,
      urdu: food.urdu,
      category: food.category,
      quantity: 2,
      unit: 'roti',
      grams: nutrients.grams,
      nutrients
    });

    const S = useStore.getState().S;
    expect(S.nutrition.logs[logDate]).toBeDefined();
    expect(S.nutrition.logs[logDate].length).toBe(1);
    expect(S.nutrition.logs[logDate][0].foodId).toBe('pk_001');
    expect(S.nutrition.logs[logDate][0].meal).toBe('breakfast');
    expect(S.nutrition.logs[logDate][0].nutrients.calories).toBeGreaterThan(150);

    // Verify recents list updated
    expect(S.nutrition.recents.length).toBe(1);
    expect(S.nutrition.recents[0].foodId).toBe('pk_001');
  });

  it('deletes a logged food entry', () => {
    const logDate = '2026-10-31';
    useStore.getState().logFoodEntry({
      date: logDate,
      meal: 'lunch',
      foodId: 'pk_050',
      name: 'Sindhi Chicken Biryani',
      quantity: 1,
      unit: 'plate',
      grams: 350,
      nutrients: { calories: 612, protein: 31, carbs: 79, fat: 19 }
    });

    let S = useStore.getState().S;
    const entryId = S.nutrition.logs[logDate][0].id;
    expect(entryId).toBeDefined();

    useStore.getState().deleteFoodLogEntry(logDate, entryId);
    S = useStore.getState().S;
    expect(S.nutrition.logs[logDate].length).toBe(0);
  });

  it('adds and manages local custom Pakistani foods without touching built-in DB', () => {
    const customDish = {
      name: 'Ami Ke Haath Ka Mutton Karahi',
      urdu: 'امی کے ہاتھ کی مٹن کڑاہی',
      category: 'Beef & Mutton Curries',
      servingUnit: 'serving',
      servingWeightGrams: 200,
      per100g: {
        calories: 220,
        protein: 19,
        carbs: 4,
        fat: 14,
        fiber: 1
      }
    };

    useStore.getState().addCustomFood(customDish);
    const S = useStore.getState().S;
    expect(S.nutrition.customFoods.length).toBe(1);
    expect(S.nutrition.customFoods[0].name).toBe('Ami Ke Haath Ka Mutton Karahi');
    expect(S.nutrition.customFoods[0].id).toContain('custom_');
  });

  it('toggles favorite foods properly', () => {
    const foodId = 'pk_001';
    useStore.getState().toggleFavoriteFood(foodId);
    let S = useStore.getState().S;
    expect(S.nutrition.favorites).toContain(foodId);

    useStore.getState().toggleFavoriteFood(foodId);
    S = useStore.getState().S;
    expect(S.nutrition.favorites).not.toContain(foodId);
  });
});
