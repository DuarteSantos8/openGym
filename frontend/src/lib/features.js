// Instance features an admin can switch off (Admin → Features, POST /api/admin/features). The
// server names only what is off, in GET /api/config `features`; anything it does not name is on,
// and so is everything with no server at all (guest mode, a phone on its own).

export const featureOn = (config, key) => config?.features?.[key] !== false

/** Exercise QR codes: the code on a machine jumps to its exercise, and exercises get codes. */
export const qrScanOn = config => featureOn(config, 'qr')
/** Life Fitness cardio consoles: their codes, whatever the exercise codes are set to. */
export const lifeFitnessOn = config => featureOn(config, 'lifeFitness')
/** Whether a workout's scan button has anything left to read. */
export const workoutScanOn = config => qrScanOn(config) || lifeFitnessOn(config)
