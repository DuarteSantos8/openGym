/* Body composition values that only a scale or an analyser gives — Apple Health has no type for
 * them, so they are not in the catalogue (catalogue.js) — shared by the app (frontend
 * lib/health/metrics.js, the form and the cards) and the server (fold.js mergeReadings, which
 * takes readings a smart scale's cloud sent, api/providers/renpho).
 *
 * Every value is stored in the canonical unit named here. `seg` marks a segmental reading (one
 * limb or the trunk, from an eight-electrode scale): those are shown side by side in the body
 * tab's segmental analysis rather than as cards of their own, and their unit is the scale's own
 * (`unit: ''`), since the scales' clouds do not say which they use for every value.
 *
 *   [type, label, unit, dim, dec, min, max, extra]
 */
const ROWS = [
  ['fatMass', 'Fat mass', 'kg', 'mass', 1, 0.5, 400],
  ['muscleMass', 'Muscle mass', 'kg', 'mass', 1, 1, 300],
  ['bodyWater', 'Body water', '%', 'none', 1, 10, 90],
  ['visceralFat', 'Visceral fat', '', 'none', 1, 1, 60],
  ['boneMass', 'Bone mass', 'kg', 'mass', 1, 0.1, 20],
  ['protein', 'Protein', '%', 'none', 1, 1, 50],
  ['bmr', 'Basal metabolic rate', 'kcal', 'none', 0, 300, 6000],
  ['metabolicAge', 'Metabolic age', 'years', 'none', 0, 5, 120],
  // From a scale's cloud only (RENPHO): not offered in the form.
  ['skeletalMuscle', 'Skeletal muscle', '%', 'none', 1, 1, 90, { form: false }],
  ['subcutaneousFat', 'Subcutaneous fat', '%', 'none', 1, 0.5, 80, { form: false }],
  ['smi', 'Skeletal muscle index', 'kg/m²', 'none', 1, 1, 30, { form: false }],
  ['whr', 'Waist-to-hip ratio', '', 'none', 2, 0.3, 2, { form: false }],
  ['bodyScore', 'Body score', '', 'none', 0, 1, 100, { form: false }],
  ['cardiacIndex', 'Cardiac index', '', 'none', 1, 0.1, 20, { form: false }],
  ['impedance', 'Impedance', 'Ω', 'none', 0, 1, 5000, { form: false }],
  ['impedance2', 'Impedance (second frequency)', 'Ω', 'none', 0, 1, 5000, { form: false }],
];

// Segmental analysis: fat and muscle per limb and the trunk, impedance at 20 and 100 kHz.
export const SEGMENTS = ['leftArm', 'rightArm', 'trunk', 'leftLeg', 'rightLeg'];
const SEG_LABEL = { leftArm: 'left arm', rightArm: 'right arm', trunk: 'trunk', leftLeg: 'left leg', rightLeg: 'right leg' };
export const SEG_KINDS = {
  segFat: { label: 'Fat', min: 0, max: 400, dec: 1, unit: '' },
  segMuscle: { label: 'Muscle', min: 0, max: 400, dec: 1, unit: '' },
  imp20: { label: 'Impedance 20 kHz', min: 1, max: 5000, dec: 0, unit: 'Ω' },
  imp100: { label: 'Impedance 100 kHz', min: 1, max: 5000, dec: 0, unit: 'Ω' },
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
/** The type of one segment's reading: segFatLeftArm, imp100Trunk… */
export const segType = (kind, part) => kind + cap(part);
for (const [kind, k] of Object.entries(SEG_KINDS)) {
  for (const part of SEGMENTS) {
    ROWS.push([segType(kind, part), `${k.label}, ${SEG_LABEL[part]}`, k.unit, 'none', k.dec, k.min, k.max, { form: false, seg: { kind, part } }]);
  }
}

export const COMPOSITION = {};
for (const [type, label, unit, dim, dec, min, max, extra = {}] of ROWS) {
  COMPOSITION[type] = { type, label, unit, dim, dec, min, max, group: 'body', kind: 'sample', ...extra };
}
export const compositionOf = type => COMPOSITION[type] || null;
