import { useState, useMemo } from 'react'
import { useStore } from '../store/useStore.js'
import { todayISO, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import {
  FITNESS_OBJECTIVES,
  ACTIVITY_LEVELS,
  MEAL_CATEGORIES,
  DAILY_MICRONUTRIENT_RDA,
  calculateBMR,
  calculateTDEE,
  validateCalorieSafety,
  calculatePersonalizedTargets,
  aggregateDailyNutrients,
  calculateDailyProgress
} from '../lib/nutrition-calc.js'
import {
  PAKISTANI_FOODS,
  PAKISTANI_FOOD_CATEGORIES,
  searchPakistaniFoods,
  calculateServingNutrients
} from '../lib/pakistani-foods-data.js'

export default function Nutrition() {
  const S = useStore(s => s.S)
  const setNutritionProfile = useStore(s => s.setNutritionProfile)
  const logFoodEntry = useStore(s => s.logFoodEntry)
  const updateFoodLogEntry = useStore(s => s.updateFoodLogEntry)
  const deleteFoodLogEntry = useStore(s => s.deleteFoodLogEntry)
  const addCustomFood = useStore(s => s.addCustomFood)
  const deleteCustomFood = useStore(s => s.deleteCustomFood)
  const toggleFavoriteFood = useStore(s => s.toggleFavoriteFood)
  const clearNutritionLogForDay = useStore(s => s.clearNutritionLogForDay)

  const [activeTab, setActiveTab] = useState('daily') // 'daily' | 'analytics'
  const [selectedDate, setSelectedDate] = useState(todayISO())
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showSearchModal, setShowSearchModal] = useState(false)
  const [showCustomFoodModal, setShowCustomFoodModal] = useState(false)
  const [showMicroDrawer, setShowMicroDrawer] = useState(false)
  const [selectedMealForAdd, setSelectedMealForAdd] = useState('lunch')
  const [expandedMeals, setExpandedMeals] = useState({
    breakfast: true,
    lunch: true,
    dinner: true,
    afternoonSnack: true
  })

  // Editing existing logged entry
  const [editingEntry, setEditingEntry] = useState(null)

  const profile = S.nutrition?.profile || null
  const targets = useMemo(() => {
    if (!profile) return null
    return calculatePersonalizedTargets(profile)
  }, [profile])

  // Current day logs
  const dayLogs = S.nutrition?.logs?.[selectedDate] || []
  const dailyTotals = useMemo(() => aggregateDailyNutrients(dayLogs), [dayLogs])
  const dailyProgress = useMemo(() => {
    if (!targets) return null
    return calculateDailyProgress(dailyTotals, targets)
  }, [dailyTotals, targets])

  // Date navigation helpers
  const changeDate = (daysDelta) => {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + daysDelta)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    setSelectedDate(`${y}-${m}-${day}`)
  }

  const isToday = selectedDate === todayISO()
  const displayDate = () => {
    if (isToday) return t('Today')
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    if (selectedDate === yesterday.toISOString().split('T')[0]) return t('Yesterday')
    return selectedDate
  }

  const toggleMealExpand = (mealId) => {
    setExpandedMeals(prev => ({ ...prev, [mealId]: !prev[mealId] }))
  }

  const openAddFood = (mealId) => {
    setSelectedMealForAdd(mealId)
    setShowSearchModal(true)
  }

  return (
    <div className="content" style={{ paddingBottom: 'calc(var(--sab, 0px) + 90px)' }}>
      {/* Top Header */}
      <header className="hdr" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 8px' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', color: 'var(--label)' }}>
            {t('Nutrition')}
          </h1>
          <span style={{ fontSize: 13, color: 'var(--label-2)' }}>
            {t('Diet Tracker & Food Library')}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setActiveTab(activeTab === 'daily' ? 'analytics' : 'daily')}
            className="chip"
            style={{
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 20,
              background: activeTab === 'analytics' ? 'var(--acc)' : 'var(--surface-2)',
              color: activeTab === 'analytics' ? 'var(--on-acc)' : 'var(--label)'
            }}
          >
            <Icon name="chart" />
            <span style={{ marginInlineStart: 4 }}>{activeTab === 'daily' ? t('Trends') : t('Log')}</span>
          </button>
          <button
            onClick={() => setShowProfileModal(true)}
            aria-label="Nutrition Settings"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--surface-2)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--label)'
            }}
          >
            <Icon name="gear" />
          </button>
        </div>
      </header>

      {/* Profile Prompt Banner if Not Set Up */}
      {!profile && (
        <div
          className="card"
          style={{
            margin: '12px 16px',
            background: 'var(--acc-soft)',
            border: '1.5px solid var(--acc-line)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--acc)', color: 'var(--on-acc)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="nutrition" />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--label)' }}>{t('Setup Your Nutrition Profile')}</div>
              <div style={{ fontSize: 13, color: 'var(--label-2)' }}>
                {t('Calculate your Mifflin-St Jeor BMR, TDEE, and personalized daily macros.')}
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowProfileModal(true)}
            style={{
              background: 'var(--acc)',
              color: 'var(--on-acc)',
              padding: '10px 16px',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 14,
              border: 'none',
              cursor: 'pointer',
              textAlign: 'center'
            }}
          >
            {t('Configure Nutrition Goals')}
          </button>
        </div>
      )}

      {/* Date Navigation Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px 14px'
        }}
      >
        <button
          onClick={() => changeDate(-1)}
          aria-label="Previous Day"
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: 'var(--surface-2)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--label)'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--label)' }}>{displayDate()}</span>
          {!isToday && (
            <button
              onClick={() => setSelectedDate(todayISO())}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 12,
                background: 'var(--acc-soft)',
                color: 'var(--acc)',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              {t('Jump to Today')}
            </button>
          )}
        </div>

        <button
          onClick={() => changeDate(1)}
          aria-label="Next Day"
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: 'var(--surface-2)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--label)'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {activeTab === 'daily' ? (
        <>
          {/* Daily Dashboard Summary Card */}
          {targets && dailyProgress && (
            <div className="card" style={{ margin: '0 16px 16px', padding: 18 }}>
              {/* Top Row: Calories Target, Consumed, Remaining */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--label-2)', fontWeight: 600 }}>
                    {t('Calories Remaining')}
                  </div>
                  <div style={{ fontSize: 34, fontWeight: 800, color: dailyProgress.calories.remaining < 0 ? 'var(--red)' : 'var(--label)', lineHeight: 1.1 }}>
                    {Math.round(dailyProgress.calories.remaining)}
                    <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--label-2)', marginInlineStart: 4 }}>kcal</span>
                  </div>
                </div>
                <div style={{ textAlign: 'end', fontSize: 13, color: 'var(--label-2)' }}>
                  <div>{t('Goal: {0} kcal', [targets.targetCalories])}</div>
                  <div style={{ color: 'var(--acc)', fontWeight: 600 }}>{t('Food: {0} kcal', [Math.round(dailyTotals.calories)])}</div>
                </div>
              </div>

              {/* Calorie Progress Bar */}
              <div style={{ height: 10, borderRadius: 5, background: 'var(--surface-3)', overflow: 'hidden', marginBottom: 18 }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, (dailyTotals.calories / targets.targetCalories) * 100)}%`,
                    background: dailyTotals.calories > targets.targetCalories ? 'var(--red)' : 'var(--acc)',
                    borderRadius: 5,
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>

              {/* 4 Core Macros Progress Rows */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Protein */}
                <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    <span style={{ color: 'var(--label)' }}>{t('Protein')}</span>
                    <span style={{ color: 'var(--acc)' }}>{Math.round(dailyTotals.protein)} / {targets.targetProtein}g</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (dailyTotals.protein / targets.targetProtein) * 100)}%`, background: 'var(--acc)', borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--label-3)', marginBlockStart: 4 }}>
                    {Math.max(0, targets.targetProtein - Math.round(dailyTotals.protein))}g left
                  </div>
                </div>

                {/* Carbohydrates */}
                <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    <span style={{ color: 'var(--label)' }}>{t('Carbs')}</span>
                    <span style={{ color: '#0a84ff' }}>{Math.round(dailyTotals.carbs)} / {targets.targetCarbs}g</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (dailyTotals.carbs / targets.targetCarbs) * 100)}%`, background: '#0a84ff', borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--label-3)', marginBlockStart: 4 }}>
                    {Math.max(0, targets.targetCarbs - Math.round(dailyTotals.carbs))}g left
                  </div>
                </div>

                {/* Fats */}
                <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    <span style={{ color: 'var(--label)' }}>{t('Fat')}</span>
                    <span style={{ color: '#ff9500' }}>{Math.round(dailyTotals.fat)} / {targets.targetFat}g</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (dailyTotals.fat / targets.targetFat) * 100)}%`, background: '#ff9500', borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--label-3)', marginBlockStart: 4 }}>
                    {Math.max(0, targets.targetFat - Math.round(dailyTotals.fat))}g left
                  </div>
                </div>

                {/* Fiber */}
                <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    <span style={{ color: 'var(--label)' }}>{t('Fiber')}</span>
                    <span style={{ color: '#30d158' }}>{Math.round(dailyTotals.fiber)} / {targets.targetFiber}g</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (dailyTotals.fiber / targets.targetFiber) * 100)}%`, background: '#30d158', borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--label-3)', marginBlockStart: 4 }}>
                    {Math.max(0, targets.targetFiber - Math.round(dailyTotals.fiber))}g left
                  </div>
                </div>
              </div>

              {/* Expandable Micronutrients Drawer Toggle */}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--sep-op)' }}>
                <button
                  onClick={() => setShowMicroDrawer(!showMicroDrawer)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--acc)',
                    padding: '4px 0'
                  }}
                >
                  <span>{showMicroDrawer ? t('Hide Micronutrients (Vitamins & Minerals)') : t('View Micronutrients (Vitamins & Minerals)')}</span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transform: showMicroDrawer ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {showMicroDrawer && (
                  <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                    {Object.entries(DAILY_MICRONUTRIENT_RDA).map(([key, rda]) => {
                      const consumed = dailyTotals[key] || 0
                      const pct = Math.round((consumed / rda.val) * 100)
                      return (
                        <div key={key} style={{ background: 'var(--surface-2)', padding: '8px 10px', borderRadius: 8 }}>
                          <div style={{ fontSize: 11, color: 'var(--label-2)', fontWeight: 500 }}>{rda.label}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label)', marginTop: 2 }}>
                            {consumed} <span style={{ fontSize: 10, color: 'var(--label-3)' }}>{rda.unit}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--surface-3)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: pct >= 100 ? '#30d158' : 'var(--acc)' }} />
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 600, color: pct >= 100 ? '#30d158' : 'var(--label-2)' }}>{pct}%</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Meals Breakdown (8 Categories) */}
          <div style={{ padding: '0 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label)' }}>{t('Meals & Logging')}</span>
              {dayLogs.length > 0 && (
                <button
                  onClick={() => {
                    if (window.confirm(t('Clear all logged foods for {0}?', [selectedDate]))) {
                      clearNutritionLogForDay(selectedDate)
                    }
                  }}
                  style={{ fontSize: 12, color: 'var(--red)', fontWeight: 500 }}
                >
                  {t('Clear Day')}
                </button>
              )}
            </div>

            {MEAL_CATEGORIES.map(cat => {
              const mealEntries = dayLogs.filter(e => e.meal === cat.id)
              const mealKcal = mealEntries.reduce((sum, e) => sum + (e.nutrients?.calories || 0), 0)
              const mealProtein = mealEntries.reduce((sum, e) => sum + (e.nutrients?.protein || 0), 0)
              const mealCarbs = mealEntries.reduce((sum, e) => sum + (e.nutrients?.carbs || 0), 0)
              const mealFat = mealEntries.reduce((sum, e) => sum + (e.nutrients?.fat || 0), 0)
              const isExpanded = expandedMeals[cat.id] ?? (mealEntries.length > 0)

              return (
                <div key={cat.id} className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
                  {/* Meal Header */}
                  <div
                    onClick={() => toggleMealExpand(cat.id)}
                    style={{
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      background: 'var(--surface)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--label)' }}>{t(cat.label)}</span>
                      {mealEntries.length > 0 && (
                        <span style={{ fontSize: 12, padding: '2px 6px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label-2)' }}>
                          {mealEntries.length}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: mealKcal > 0 ? 'var(--acc)' : 'var(--label-3)' }}>
                        {Math.round(mealKcal)} kcal
                      </span>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', color: 'var(--label-3)' }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>

                  {/* Meal Expanded Body */}
                  {isExpanded && (
                    <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--sep-op)' }}>
                      {/* Macro subtotal badges */}
                      {mealEntries.length > 0 && (
                        <div style={{ display: 'flex', gap: 12, padding: '8px 0', fontSize: 12, color: 'var(--label-2)' }}>
                          <span>P: <strong style={{ color: 'var(--label)' }}>{Math.round(mealProtein)}g</strong></span>
                          <span>C: <strong style={{ color: 'var(--label)' }}>{Math.round(mealCarbs)}g</strong></span>
                          <span>F: <strong style={{ color: 'var(--label)' }}>{Math.round(mealFat)}g</strong></span>
                        </div>
                      )}

                      {/* Logged Item Rows */}
                      {mealEntries.map(entry => (
                        <div
                          key={entry.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 0',
                            borderBottom: '1px solid var(--sep-op)'
                          }}
                        >
                          <div style={{ flex: 1, paddingInlineEnd: 10 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--label)' }}>
                              {entry.name}
                              {entry.urdu && <span style={{ marginInlineStart: 6, fontSize: 12, color: 'var(--label-3)', fontFamily: 'system-ui' }}>{entry.urdu}</span>}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--label-2)', marginTop: 2 }}>
                              {entry.quantity} {entry.unit} ({Math.round(entry.grams)}g) • P: {Math.round(entry.nutrients?.protein || 0)}g, C: {Math.round(entry.nutrients?.carbs || 0)}g, F: {Math.round(entry.nutrients?.fat || 0)}g
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--label)' }}>
                              {Math.round(entry.nutrients?.calories || 0)}
                            </span>
                            <button
                              onClick={() => deleteFoodLogEntry(selectedDate, entry.id)}
                              aria-label="Delete entry"
                              style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--surface-2)', color: 'var(--label-3)', display: 'grid', placeItems: 'center' }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}

                      {/* Add Food Button */}
                      <button
                        onClick={() => openAddFood(cat.id)}
                        style={{
                          width: '100%',
                          marginTop: 10,
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: 'var(--surface-2)',
                          color: 'var(--acc)',
                          fontSize: 13,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        <span>{t('Add to {0}', [t(cat.label)])}</span>
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        /* Historical Analytics & Trends Tab */
        <NutritionAnalytics S={S} profile={profile} targets={targets} />
      )}

      {/* Floating Action / Quick Search Button */}
      <div
        style={{
          position: 'fixed',
          bottom: 'calc(var(--sab, 0px) + 70px)',
          insetInlineEnd: 20,
          zIndex: 90
        }}
      >
        <button
          onClick={() => openAddFood('lunch')}
          style={{
            height: 52,
            padding: '0 20px',
            borderRadius: 26,
            background: 'var(--acc)',
            color: 'var(--on-acc)',
            fontWeight: 700,
            fontSize: 15,
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            border: 'none',
            cursor: 'pointer'
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{t('Log Pakistani Food')}</span>
        </button>
      </div>

      {/* Profile & Goal Setup Modal */}
      {showProfileModal && (
        <ProfileSetupModal
          initialProfile={profile}
          S={S}
          onSave={p => {
            setNutritionProfile(p)
            setShowProfileModal(false)
          }}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {/* Food Search & Fast Logger Modal */}
      {showSearchModal && (
        <FoodSearchModal
          defaultMeal={selectedMealForAdd}
          S={S}
          onLogFood={(entry) => {
            logFoodEntry({ ...entry, date: selectedDate })
            setShowSearchModal(false)
          }}
          onOpenCustomFood={() => {
            setShowSearchModal(false)
            setShowCustomFoodModal(true)
          }}
          onToggleFav={toggleFavoriteFood}
          onClose={() => setShowSearchModal(false)}
        />
      )}

      {/* Custom Food Creation Modal */}
      {showCustomFoodModal && (
        <CustomFoodModal
          onSave={(food) => {
            addCustomFood(food)
            setShowCustomFoodModal(false)
            setShowSearchModal(true)
          }}
          onClose={() => {
            setShowCustomFoodModal(false)
            setShowSearchModal(true)
          }}
        />
      )}
    </div>
  )
}

/* ========================================================================= */
/* SUB-COMPONENT: Profile Setup & Goal Calculation Modal                     */
/* ========================================================================= */

function ProfileSetupModal({ initialProfile, S, onSave, onClose }) {
  // Pre-fill from existing S where available
  const [age, setAge] = useState(initialProfile?.age || 26)
  const [gender, setGender] = useState(initialProfile?.gender || S.body || 'male')
  const [height, setHeight] = useState(initialProfile?.height || 175)
  const [weight, setWeight] = useState(initialProfile?.weight || (S.bodyweight?.[S.bodyweight.length - 1]?.w) || 75)
  const [targetWeight, setTargetWeight] = useState(initialProfile?.targetWeight || S.targetW || 72)
  const [activityLevel, setActivityLevel] = useState(initialProfile?.activityLevel || 'moderate')
  const [objective, setObjective] = useState(initialProfile?.objective || 'weight_loss')
  const [customAdjustment, setCustomAdjustment] = useState(initialProfile?.customDeficit ?? null)

  // Real-time metabolic preview
  const bmr = calculateBMR({ weight, height, age, gender })
  const tdee = calculateTDEE(bmr, activityLevel)
  const objObj = FITNESS_OBJECTIVES.find(o => o.id === objective) || FITNESS_OBJECTIVES[0]
  const currentAdjustment = customAdjustment !== null ? customAdjustment : objObj.defaultAdjustment
  const safety = validateCalorieSafety(tdee, currentAdjustment, gender, bmr)

  const handleSave = () => {
    const finalProfile = {
      age: parseInt(age) || 25,
      gender,
      height: parseFloat(height) || 170,
      weight: parseFloat(weight) || 70,
      targetWeight: parseFloat(targetWeight) || 70,
      activityLevel,
      objective,
      bmr,
      tdee,
      customDeficit: customAdjustment
    }
    onSave(finalProfile)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center'
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          borderRadius: '20px 20px 0 0',
          padding: 20,
          overflowY: 'auto',
          background: 'var(--surface)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--label)' }}>
            {t('Nutrition Profile & Goals')}
          </h2>
          <button onClick={onClose} style={{ fontSize: 22, color: 'var(--label-3)' }}>&times;</button>
        </div>

        {/* Inputs Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Gender')}</label>
            <select
              value={gender}
              onChange={e => setGender(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
            >
              <option value="male">{t('Male')}</option>
              <option value="female">{t('Female')}</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Age (Years)')}</label>
            <input
              type="number"
              value={age}
              onChange={e => setAge(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Height (cm)')}</label>
            <input
              type="number"
              value={height}
              onChange={e => setHeight(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Current Weight (kg)')}</label>
            <input
              type="number"
              step="0.1"
              value={weight}
              onChange={e => setWeight(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
            />
          </div>
        </div>

        {/* Target Weight */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Target Weight (kg)')}</label>
          <input
            type="number"
            step="0.1"
            value={targetWeight}
            onChange={e => setTargetWeight(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
          />
        </div>

        {/* Activity Level */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Activity Level')}</label>
          <select
            value={activityLevel}
            onChange={e => setActivityLevel(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
          >
            {ACTIVITY_LEVELS.map(a => (
              <option key={a.id} value={a.id}>{a.label} ({a.multiplier}x) — {a.desc}</option>
            ))}
          </select>
        </div>

        {/* Fitness Objective */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Fitness Objective')}</label>
          <select
            value={objective}
            onChange={e => {
              setObjective(e.target.value)
              setCustomAdjustment(null)
            }}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
          >
            {FITNESS_OBJECTIVES.map(o => (
              <option key={o.id} value={o.id}>{o.label} ({o.defaultAdjustment > 0 ? `+${o.defaultAdjustment}` : o.defaultAdjustment} kcal)</option>
            ))}
          </select>
        </div>

        {/* Metabolic Calculations Banner */}
        <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, textAlign: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--label-2)' }}>{t('Mifflin-St Jeor BMR')}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label)' }}>{bmr} <span style={{ fontSize: 12 }}>kcal</span></div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--label-2)' }}>{t('Maintenance (TDEE)')}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label)' }}>{tdee} <span style={{ fontSize: 12 }}>kcal</span></div>
            </div>
          </div>

          {/* Calorie Deficit / Surplus Slider */}
          <div style={{ borderTop: '1px solid var(--sep-op)', paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              <span style={{ color: 'var(--label-2)' }}>{t('Selected Calorie Adjustment:')}</span>
              <span style={{ color: currentAdjustment < 0 ? 'var(--red)' : currentAdjustment > 0 ? '#30d158' : 'var(--label)' }}>
                {currentAdjustment > 0 ? `+${currentAdjustment}` : currentAdjustment} kcal
              </span>
            </div>
            <input
              type="range"
              min="-1200"
              max="1000"
              step="50"
              value={currentAdjustment}
              onChange={e => setCustomAdjustment(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--acc)' }}
            />
          </div>

          <div style={{ marginTop: 10, textAlign: 'center', fontSize: 14 }}>
            {t('Daily Calorie Target:')} <strong style={{ fontSize: 20, color: 'var(--acc)' }}>{safety.targetCalories} kcal</strong>
          </div>
        </div>

        {/* Safety Warnings Banner */}
        {safety.warnings.length > 0 && (
          <div style={{ background: 'rgba(255, 69, 58, 0.12)', border: '1px solid var(--red)', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--red)', fontWeight: 700 }}>⚠️</span>
              <div style={{ fontSize: 12, color: 'var(--red)', lineHeight: 1.4 }}>
                {safety.warnings.map((w, idx) => (
                  <div key={idx} style={{ marginBottom: 4 }}>{w}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          style={{
            background: 'var(--acc)',
            color: 'var(--on-acc)',
            padding: '14px',
            borderRadius: 12,
            fontWeight: 700,
            fontSize: 16,
            border: 'none',
            cursor: 'pointer',
            textAlign: 'center',
            marginTop: 4
          }}
        >
          {t('Save Nutrition Goals')}
        </button>
      </div>
    </div>
  )
}

/* ========================================================================= */
/* SUB-COMPONENT: Fast Pakistani Food Search & Log Modal                     */
/* ========================================================================= */

function FoodSearchModal({ defaultMeal, S, onLogFood, onOpenCustomFood, onToggleFav, onClose }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'recents' | 'favorites' | 'custom'

  // Food selection stage for quantity entry
  const [selectedFood, setSelectedFood] = useState(null)
  const [quantity, setQuantity] = useState(1)
  const [unit, setUnit] = useState('serving')
  const [chosenMeal, setChosenMeal] = useState(defaultMeal)

  const favorites = S.nutrition?.favorites || []
  const recents = S.nutrition?.recents || []
  const customFoods = S.nutrition?.customFoods || []

  // Filtered foods
  const filteredFoods = useMemo(() => {
    let sourceList = PAKISTANI_FOODS
    if (activeTab === 'favorites') {
      sourceList = PAKISTANI_FOODS.filter(f => favorites.includes(f.id))
    } else if (activeTab === 'custom') {
      sourceList = customFoods
    } else if (activeTab === 'recents') {
      const recentIds = recents.map(r => r.foodId)
      sourceList = PAKISTANI_FOODS.filter(f => recentIds.includes(f.id))
    }

    const q = searchQuery.trim().toLowerCase()
    return sourceList.filter(item => {
      const matchesCat = selectedCategory === 'All' ? true : item.category === selectedCategory
      if (!matchesCat) return false
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        (item.urdu && item.urdu.includes(q)) ||
        item.category.toLowerCase().includes(q)
      )
    })
  }, [searchQuery, selectedCategory, activeTab, favorites, recents, customFoods])

  // Calculated nutrients for the item being configured
  const calculatedNutrients = useMemo(() => {
    if (!selectedFood) return null
    return calculateServingNutrients(selectedFood, quantity, unit)
  }, [selectedFood, quantity, unit])

  const handleSelectFood = (food) => {
    setSelectedFood(food)
    setUnit(food.servingUnit || 'serving')
    setQuantity(1)
  }

  const handleConfirmLog = () => {
    if (!selectedFood || !calculatedNutrients) return
    onLogFood({
      foodId: selectedFood.id,
      name: selectedFood.name,
      urdu: selectedFood.urdu,
      category: selectedFood.category,
      meal: chosenMeal,
      quantity,
      unit,
      grams: calculatedNutrients.grams,
      nutrients: calculatedNutrients
    })
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center'
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 560,
          height: '85vh',
          borderRadius: '20px 20px 0 0',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.3)'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--label)' }}>
              {selectedFood ? t('Configure Serving') : t('Pakistani Food Database')}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--label-2)' }}>
              {selectedFood ? selectedFood.name : t('625+ Authentic Pakistani Dishes')}
            </div>
          </div>
          <button onClick={onClose} style={{ fontSize: 24, color: 'var(--label-3)' }}>&times;</button>
        </div>

        {selectedFood ? (
          /* Step 2: Serving Customizer View */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', flex: 1 }}>
            {/* Food Info Pill */}
            <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label)' }}>{selectedFood.name}</div>
                  {selectedFood.urdu && (
                    <div style={{ fontSize: 14, color: 'var(--acc)', fontFamily: 'system-ui', marginTop: 2 }}>{selectedFood.urdu}</div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--label-3)', marginTop: 4 }}>{selectedFood.category}</div>
                </div>
                <button
                  onClick={() => onToggleFav(selectedFood.id)}
                  style={{ fontSize: 20, color: favorites.includes(selectedFood.id) ? '#ffd60a' : 'var(--label-3)' }}
                >
                  ★
                </button>
              </div>
              {selectedFood.prepNotes && (
                <div style={{ fontSize: 12, color: 'var(--label-2)', marginTop: 8, fontStyle: 'italic' }}>
                  ℹ️ {selectedFood.prepNotes}
                </div>
              )}
            </div>

            {/* Meal Category Picker */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Meal')}</label>
              <select
                value={chosenMeal}
                onChange={e => setChosenMeal(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
              >
                {MEAL_CATEGORIES.map(m => (
                  <option key={m.id} value={m.id}>{t(m.label)}</option>
                ))}
              </select>
            </div>

            {/* Quantity and Unit Inputs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Quantity')}</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.1"
                  value={quantity}
                  onChange={e => setQuantity(Math.max(0.1, parseFloat(e.target.value) || 0))}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Unit')}</label>
                <select
                  value={unit}
                  onChange={e => setUnit(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
                >
                  <option value="serving">1 standard {selectedFood.servingUnit} ({selectedFood.servingWeightGrams}g)</option>
                  <option value="g">{t('Grams (g)')}</option>
                  <option value="ml">{t('Millilitres (ml)')}</option>
                  <option value="piece">{t('Pieces')}</option>
                </select>
              </div>
            </div>

            {/* Live Calculated Nutrients Card */}
            {calculatedNutrients && (
              <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--label-2)', fontWeight: 600 }}>{t('Calculated Nutrients')}</span>
                  <span style={{ fontSize: 13, color: 'var(--label-3)' }}>{calculatedNutrients.grams}g total</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, textAlign: 'center' }}>
                  <div style={{ background: 'var(--surface)', padding: 8, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--label-2)' }}>Calories</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--acc)' }}>{calculatedNutrients.calories}</div>
                  </div>
                  <div style={{ background: 'var(--surface)', padding: 8, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--label-2)' }}>Protein</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label)' }}>{calculatedNutrients.protein}g</div>
                  </div>
                  <div style={{ background: 'var(--surface)', padding: 8, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--label-2)' }}>Carbs</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label)' }}>{calculatedNutrients.carbs}g</div>
                  </div>
                  <div style={{ background: 'var(--surface)', padding: 8, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--label-2)' }}>Fat</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label)' }}>{calculatedNutrients.fat}g</div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
              <button
                onClick={() => setSelectedFood(null)}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 10,
                  background: 'var(--surface-2)',
                  color: 'var(--label)',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                {t('Back to Search')}
              </button>
              <button
                onClick={handleConfirmLog}
                style={{
                  flex: 2,
                  padding: 12,
                  borderRadius: 10,
                  background: 'var(--acc)',
                  color: 'var(--on-acc)',
                  fontWeight: 700,
                  fontSize: 15,
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                {t('Add to Daily Log')}
              </button>
            </div>
          </div>
        ) : (
          /* Step 1: Fast Search & Browse View */
          <>
            {/* Search Input */}
            <div style={{ position: 'relative', marginBottom: 10 }}>
              <input
                type="text"
                placeholder={t('Search Pakistani dishes (e.g. Biryani, Karahi, Roti, Daal)...')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 14px 12px 38px',
                  borderRadius: 10,
                  background: 'var(--surface-2)',
                  color: 'var(--label)',
                  border: '1px solid var(--sep-op)',
                  fontSize: 14
                }}
              />
              <div style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--label-3)' }}>
                <Icon name="magnifier" />
              </div>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ position: 'absolute', insetInlineEnd: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--label-3)', fontSize: 18 }}
                >
                  &times;
                </button>
              )}
            </div>

            {/* Source Filter Tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto', paddingBottom: 4 }}>
              {[
                { id: 'all', label: `Pakistani Dishes (${PAKISTANI_FOODS.length})` },
                { id: 'recents', label: `Recents (${recents.length})` },
                { id: 'favorites', label: `Favorites (${favorites.length})` },
                { id: 'custom', label: `My Custom (${customFoods.length})` }
              ].map(tb => (
                <button
                  key={tb.id}
                  onClick={() => setActiveTab(tb.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 16,
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    background: activeTab === tb.id ? 'var(--acc)' : 'var(--surface-2)',
                    color: activeTab === tb.id ? 'var(--on-acc)' : 'var(--label-2)',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {tb.label}
                </button>
              ))}
            </div>

            {/* Category Filter Pills */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', paddingBottom: 6 }}>
              {['All', ...PAKISTANI_FOOD_CATEGORIES].map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: selectedCategory === cat ? 700 : 500,
                    whiteSpace: 'nowrap',
                    background: selectedCategory === cat ? 'var(--label)' : 'var(--surface-2)',
                    color: selectedCategory === cat ? 'var(--bg)' : 'var(--label-2)',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Food List Results */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredFoods.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--label-3)' }}>
                  <div>{t('No dishes found matching your search.')}</div>
                  <button
                    onClick={onOpenCustomFood}
                    style={{
                      marginTop: 12,
                      padding: '8px 16px',
                      borderRadius: 8,
                      background: 'var(--acc)',
                      color: 'var(--on-acc)',
                      fontWeight: 600,
                      fontSize: 13,
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {t('+ Create Custom Dish')}
                  </button>
                </div>
              ) : (
                filteredFoods.map(food => (
                  <div
                    key={food.id}
                    onClick={() => handleSelectFood(food)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: 'var(--surface-2)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ flex: 1, paddingInlineEnd: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--label)' }}>{food.name}</span>
                        {food.urdu && (
                          <span style={{ fontSize: 12, color: 'var(--acc)', fontFamily: 'system-ui' }}>{food.urdu}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--label-3)', marginTop: 2 }}>
                        {food.category} • 1 {food.servingUnit} ({food.servingWeightGrams}g)
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ textAlign: 'end' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--label)' }}>
                          {Math.round((food.per100g.calories * (food.servingWeightGrams || 100)) / 100)} kcal
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--label-3)' }}>
                          P: {Math.round((food.per100g.protein * (food.servingWeightGrams || 100)) / 100)}g
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleFav(food.id)
                        }}
                        style={{ fontSize: 18, color: favorites.includes(food.id) ? '#ffd60a' : 'var(--label-3)' }}
                      >
                        ★
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Bottom bar with create custom food link */}
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--sep-op)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--label-3)' }}>{t('{0} items shown', [filteredFoods.length])}</span>
              <button
                onClick={onOpenCustomFood}
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--acc)' }}
              >
                {t('+ Create Custom Food')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ========================================================================= */
/* SUB-COMPONENT: Custom Food Creator Modal                                  */
/* ========================================================================= */

function CustomFoodModal({ onSave, onClose }) {
  const [name, setName] = useState('')
  const [urdu, setUrdu] = useState('')
  const [category, setCategory] = useState('Chicken Curries & Gravies')
  const [servingUnit, setServingUnit] = useState('serving')
  const [servingWeightGrams, setServingWeightGrams] = useState(150)
  const [calories, setCalories] = useState(200)
  const [protein, setProtein] = useState(15)
  const [carbs, setCarbs] = useState(10)
  const [fat, setFat] = useState(8)
  const [fiber, setFiber] = useState(2)

  const handleSave = () => {
    if (!name.trim()) {
      alert(t('Please enter a dish name.'))
      return
    }
    const servG = parseFloat(servingWeightGrams) || 100
    // Factor to store normalized per 100g
    const factor = 100.0 / servG
    const customFood = {
      name: name.trim(),
      urdu: urdu.trim(),
      category,
      servingUnit,
      servingWeightGrams: servG,
      per100g: {
        calories: Math.round(parseFloat(calories) * factor * 10) / 10,
        protein: Math.round(parseFloat(protein) * factor * 10) / 10,
        carbs: Math.round(parseFloat(carbs) * factor * 10) / 10,
        fat: Math.round(parseFloat(fat) * factor * 10) / 10,
        fiber: Math.round(parseFloat(fiber) * factor * 10) / 10,
        sugar: 1.0,
        saturatedFat: Math.round(parseFloat(fat) * 0.3 * factor * 10) / 10,
        transFat: 0.0,
        sodium: 350.0,
        calcium: 20.0,
        iron: 1.5
      },
      verified: false,
      source: 'User Custom Recipe'
    }
    onSave(customFood)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center'
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 520,
          maxHeight: '85vh',
          borderRadius: '20px 20px 0 0',
          padding: 20,
          overflowY: 'auto',
          background: 'var(--surface)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--label)' }}>
            {t('Create Custom Pakistani Dish')}
          </h2>
          <button onClick={onClose} style={{ fontSize: 24, color: 'var(--label-3)' }}>&times;</button>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Dish Name (English)')}</label>
          <input
            type="text"
            placeholder="e.g. Homemade Shinwari Chicken"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Name in Urdu (Optional)')}</label>
          <input
            type="text"
            placeholder="e.g. گھریلو شنواری چکن"
            value={urdu}
            onChange={e => setUrdu(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4, fontFamily: 'system-ui' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Category')}</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
            >
              {PAKISTANI_FOOD_CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{t('Serving Weight (g)')}</label>
            <input
              type="number"
              value={servingWeightGrams}
              onChange={e => setServingWeightGrams(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 4 }}
            />
          </div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label)', marginTop: 6 }}>
          {t('Nutritional Information (Per 1 Serving):')}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--label-2)' }}>Calories (kcal)</label>
            <input
              type="number"
              value={calories}
              onChange={e => setCalories(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 2 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--label-2)' }}>Protein (g)</label>
            <input
              type="number"
              value={protein}
              onChange={e => setProtein(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 2 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--label-2)' }}>Carbohydrates (g)</label>
            <input
              type="number"
              value={carbs}
              onChange={e => setCarbs(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 2 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--label-2)' }}>Total Fat (g)</label>
            <input
              type="number"
              value={fat}
              onChange={e => setFat(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', marginTop: 2 }}
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          style={{
            background: 'var(--acc)',
            color: 'var(--on-acc)',
            padding: '12px',
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 15,
            border: 'none',
            cursor: 'pointer',
            marginTop: 10
          }}
        >
          {t('Save Custom Food')}
        </button>
      </div>
    </div>
  )
}

/* ========================================================================= */
/* SUB-COMPONENT: Nutrition Analytics & Historical Trends View               */
/* ========================================================================= */

function NutritionAnalytics({ S, profile, targets }) {
  const logs = S.nutrition?.logs || {}
  const dates = Object.keys(logs).sort().slice(-7) // Last 7 days

  const dailyHistory = dates.map(d => {
    const totals = aggregateDailyNutrients(logs[d] || [])
    return {
      date: d,
      calories: Math.round(totals.calories),
      protein: Math.round(totals.protein),
      carbs: Math.round(totals.carbs),
      fat: Math.round(totals.fat),
      fiber: Math.round(totals.fiber)
    }
  })

  const avgKcal = dailyHistory.length > 0
    ? Math.round(dailyHistory.reduce((s, h) => s + h.calories, 0) / dailyHistory.length)
    : 0

  const avgProtein = dailyHistory.length > 0
    ? Math.round(dailyHistory.reduce((s, h) => s + h.protein, 0) / dailyHistory.length)
    : 0

  const avgCarbs = dailyHistory.length > 0
    ? Math.round(dailyHistory.reduce((s, h) => s + h.carbs, 0) / dailyHistory.length)
    : 0

  const avgFat = dailyHistory.length > 0
    ? Math.round(dailyHistory.reduce((s, h) => s + h.fat, 0) / dailyHistory.length)
    : 0

  const maxChartCal = Math.max((targets?.targetCalories || 2000) * 1.2, ...dailyHistory.map(h => h.calories), 2200)

  return (
    <div style={{ padding: '0 16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 7-Day Calorie History Chart */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label)' }}>{t('Weekly Calorie Adherence')}</div>
            <div style={{ fontSize: 12, color: 'var(--label-2)' }}>{t('Target: {0} kcal', [targets?.targetCalories || 2000])}</div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--acc)' }}>{avgKcal}</div>
            <div style={{ fontSize: 11, color: 'var(--label-3)' }}>{t('7-day avg kcal')}</div>
          </div>
        </div>

        {dailyHistory.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--label-3)', fontSize: 13 }}>
            {t('Log foods across multiple days to view weekly intake trends.')}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: 160, paddingTop: 20 }}>
            {dailyHistory.map(day => {
              const heightPct = Math.min(100, Math.round((day.calories / maxChartCal) * 100))
              const isOver = targets && day.calories > targets.targetCalories
              return (
                <div key={day.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--label-2)' }}>{day.calories}</span>
                  <div style={{ width: '60%', maxWidth: 28, height: `${heightPct}%`, background: isOver ? 'var(--red)' : 'var(--acc)', borderRadius: '6px 6px 0 0', minHeight: 4 }} />
                  <span style={{ fontSize: 10, color: 'var(--label-3)' }}>{day.date.slice(5)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 7-Day Macro Averages */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--label)', marginBottom: 12 }}>
          {t('Average Daily Macronutrients')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, textAlign: 'center' }}>
          <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--label-2)', fontWeight: 600 }}>Protein</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--acc)', marginTop: 2 }}>{avgProtein}g</div>
            <div style={{ fontSize: 10, color: 'var(--label-3)' }}>Target: {targets?.targetProtein || 0}g</div>
          </div>
          <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--label-2)', fontWeight: 600 }}>Carbs</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0a84ff', marginTop: 2 }}>{avgCarbs}g</div>
            <div style={{ fontSize: 10, color: 'var(--label-3)' }}>Target: {targets?.targetCarbs || 0}g</div>
          </div>
          <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--label-2)', fontWeight: 600 }}>Fat</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#ff9500', marginTop: 2 }}>{avgFat}g</div>
            <div style={{ fontSize: 10, color: 'var(--label-3)' }}>Target: {targets?.targetFat || 0}g</div>
          </div>
        </div>
      </div>
    </div>
  )
}
