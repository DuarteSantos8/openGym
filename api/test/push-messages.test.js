import test from 'node:test';
import assert from 'node:assert/strict';
import { dayReminderPush, restTimerPush, routineEmoji, testPush } from '../push-messages.js';

test('localizes every server-generated notification in pt-BR', () => {
  assert.deepEqual(restTimerPush('pt-BR'), {
    title: 'Descanso terminado 💪',
    body: 'Hora da próxima série.',
    tag: 'rest-timer',
  });
  assert.deepEqual(testPush('pt-BR'), {
    title: 'openGym',
    body: 'Notificação de teste ✅ É assim que os alertas aparecem.',
    tag: 'test',
  });
  assert.deepEqual(dayReminderPush('pt-BR', { name: 'Treino A', emoji: '💪' }), {
    title: '💪 Treino A hoje',
    body: 'Está no seu plano. Bora treinar 💪',
    tag: 'day-reminder',
  });
});

test('keeps the existing English copy as the fallback', () => {
  assert.deepEqual(restTimerPush('fr'), restTimerPush('en'));
  assert.equal(dayReminderPush('unknown', null).title, 'Workout planned today');
  assert.equal(testPush(undefined).body, 'Test notification ✅ This is what alerts look like.');
});

// Routines stopped storing a literal emoji when the glyph picker landed: `emoji` now holds an
// icon key the app renders as an SVG. A notification has no SVG, so before this the reminder
// read "dumbbell Push today" — the key's own name, on the lock screen.
test('renders a routine glyph key as an emoji, never as its name', () => {
  assert.equal(routineEmoji('dumbbell'), '🏋️');
  assert.equal(routineEmoji('figureRun'), '🏃');
  assert.equal(routineEmoji('legs'), '🦵');
  assert.equal(
    dayReminderPush('pt-BR', { name: 'Costas e Bíceps', emoji: 'dumbbell' }).title,
    '🏋️ Costas e Bíceps hoje',
  );
});

test('leaves a literal emoji alone and falls back for anything else', () => {
  assert.equal(routineEmoji('💪'), '💪');
  assert.equal(routineEmoji('🏋️‍♀️'), '🏋️‍♀️');
  // An icon key the picker no longer offers is still ASCII, so it falls back to the default
  // rather than reaching the phone as a word.
  assert.equal(routineEmoji('trophy'), '🏋️');
  assert.equal(routineEmoji(''), '🏋️');
  assert.equal(routineEmoji(undefined), '🏋️');
});
