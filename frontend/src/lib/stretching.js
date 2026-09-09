// A small, standalone mobility catalogue. These are gentle static stretches intended for
// normal training recovery; the app does not prescribe a diagnosis or force a range of motion.
// Images are bundled with the web shell at /stretching so they are not hidden by the existing
// /img media mount.
export const STRETCHES = [
  {
    id: 'standing-chest-stretch', group: 'chest', muscle: 'Chest',
    name: 'Standing chest stretch with hands clasped behind', target: 'Pectorals and anterior shoulders',
    instructions: ['Stand tall with feet hip-width apart.', 'Clasp your hands behind your hips and gently straighten your elbows.', 'Lift your hands a few centimetres and draw your shoulders back without arching your lower back.'],
    hold: '30 s', image: '/stretching/standing-chest-stretch.png', width: 1344, height: 768,
    es: { muscle: 'Pecho', name: 'Estiramiento de pecho de pie con manos entrelazadas', target: 'Pectorales y hombros anteriores', instructions: ['Párate alto con los pies a la anchura de la cadera.', 'Entrelaza las manos detrás de la cadera y estira suavemente los codos.', 'Eleva las manos unos centímetros y lleva los hombros atrás, sin arquear la zona lumbar.'], hold: '30 s' },
  },
  {
    id: 'standing-lat-stretch', group: 'back', muscle: 'Back',
    name: '90-degree standing lat stretch', target: 'Lats and upper back',
    instructions: ['Place your hands on a sturdy support.', 'Hinge at the hips and send your hips back with a neutral spine.', 'Lengthen through your back without sinking your shoulders or bouncing.'],
    hold: '30 s', image: '/stretching/standing-lat-stretch.png', width: 1344, height: 768,
    es: { muscle: 'Espalda', name: 'Estiramiento de dorsales a 90°', target: 'Dorsales y espalda alta', instructions: ['Apoya las manos en un soporte firme.', 'Lleva la cadera atrás haciendo bisagra, con la columna neutra.', 'Alarga la espalda sin hundir los hombros ni rebotar.'], hold: '30 s' },
  },
  {
    id: 'cross-body-shoulder-stretch', group: 'shoulders', muscle: 'Shoulders',
    name: 'Cross-body shoulder stretch', target: 'Posterior deltoids',
    instructions: ['Bring one arm straight across your chest.', 'Support it above or below the elbow and draw it in gently.', 'Keep the shoulder down and switch sides.'],
    hold: '30 s each side', image: '/stretching/cross-body-shoulder-stretch.png', width: 1344, height: 768,
    es: { muscle: 'Hombros', name: 'Estiramiento cruzado de hombro', target: 'Deltoides posteriores', instructions: ['Lleva un brazo recto por delante del pecho.', 'Sujétalo por encima o debajo del codo y acércalo suavemente.', 'Mantén el hombro abajo y cambia de lado.'], hold: '30 s por lado' },
  },
  {
    id: 'seated-biceps-stretch', group: 'biceps', muscle: 'Biceps',
    name: 'Seated biceps stretch', target: 'Biceps and anterior shoulders',
    instructions: ['Sit with your knees bent and feet supported.', 'Place your palms behind you with fingers pointing away.', 'Slide your hips forward without arching your back.'],
    hold: '15–30 s', image: '/stretching/seated-biceps-stretch.png', width: 1344, height: 768,
    es: { muscle: 'Bíceps', name: 'Estiramiento de bíceps sentado', target: 'Bíceps y parte frontal del hombro', instructions: ['Siéntate con las rodillas flexionadas y las plantas apoyadas.', 'Coloca las palmas detrás del cuerpo, con los dedos apuntando lejos.', 'Desliza la cadera hacia delante sin arquear la espalda.'], hold: '15–30 s' },
  },
  {
    id: 'triceps-overhead', group: 'triceps', muscle: 'Triceps',
    name: 'Overhead triceps stretch', target: 'Triceps',
    instructions: ['Raise one arm and bend the elbow so the hand reaches down your upper back.', 'Apply gentle pressure just above the elbow without forcing it.', 'Keep your head neutral and repeat on the other side.'],
    hold: '15–30 s each side', image: '/stretching/overhead-triceps.png', width: 1376, height: 768,
    es: { muscle: 'Tríceps', name: 'Estiramiento de tríceps por encima de la cabeza', target: 'Tríceps', instructions: ['Eleva un brazo y flexiona el codo para que la mano caiga detrás de la espalda alta.', 'Aplica una presión suave justo por encima del codo, sin forzar.', 'Mantén la cabeza neutra y repite al otro lado.'], hold: '15–30 s por lado' },
  },
  {
    id: 'standing-quadriceps-stretch', group: 'quads', muscle: 'Quadriceps',
    name: 'Standing quadriceps stretch', target: 'Quadriceps',
    instructions: ['Use a wall for support and bring one heel toward your glute.', 'Keep your knees together and your torso upright.', 'Avoid arching your lower back and switch sides.'],
    hold: '30 s each side', image: '/stretching/standing-quadriceps-stretch.png', width: 1344, height: 768,
    es: { muscle: 'Cuádriceps', name: 'Estiramiento de cuádriceps de pie', target: 'Cuádriceps', instructions: ['Sujétate a una pared y lleva un talón hacia el glúteo.', 'Mantén las rodillas juntas y el torso erguido.', 'Evita arquear la zona lumbar y cambia de lado.'], hold: '30 s por lado' },
  },
  {
    id: 'supine-hamstring-stretch', group: 'hamstrings', muscle: 'Hamstrings',
    name: 'Supine hamstring stretch', target: 'Hamstrings',
    instructions: ['Lie on your back and loop a strap around your foot.', 'Raise the leg with the knee slightly relaxed.', 'Straighten it gradually until you feel comfortable tension.'],
    hold: '30 s each side', image: '/stretching/supine-hamstring-stretch.png', width: 1344, height: 768,
    es: { muscle: 'Isquiotibiales', name: 'Estiramiento de isquiotibiales tumbado', target: 'Isquiotibiales', instructions: ['Túmbate boca arriba y coloca una correa alrededor del pie.', 'Eleva la pierna con la rodilla ligeramente relajada.', 'Estírala de forma gradual hasta notar tensión cómoda.'], hold: '30 s por lado' },
  },
  {
    id: 'seated-figure-four-stretch', group: 'glutes', muscle: 'Glutes',
    name: 'Seated figure-four stretch', target: 'Gluteus maximus and hip rotators',
    instructions: ['Sit tall and place one ankle on the opposite thigh above the knee.', 'Let the knee open out and hinge from the hips with a flat back.', 'Keep your pelvis steady and switch sides.'],
    hold: '30–45 s each side', image: '/stretching/seated-figure-four.png', width: 1376, height: 768,
    es: { muscle: 'Glúteos', name: 'Figura cuatro sentado', target: 'Glúteo mayor y rotadores de cadera', instructions: ['Siéntate alto y coloca un tobillo sobre el muslo contrario, por encima de la rodilla.', 'Deja que la rodilla se abra hacia fuera y flexiona desde las caderas con la espalda plana.', 'Mantén la pelvis estable y cambia de lado.'], hold: '30–45 s por lado' },
  },
  {
    id: 'wall-calf-stretch', group: 'calves', muscle: 'Calves',
    name: 'Wall calf stretch', target: 'Gastrocnemius and soleus',
    instructions: ['Place your hands on a wall and step one leg back.', 'Keep the back heel down, feet pointing forward, and back knee straight.', 'Bend the front knee and switch sides.'],
    hold: '30 s each side', image: '/stretching/wall-calf.png', width: 1376, height: 768,
    es: { muscle: 'Pantorrillas', name: 'Estiramiento de pantorrilla en pared', target: 'Gastrocnemio y sóleo', instructions: ['Apoya las manos en la pared y lleva una pierna atrás.', 'Mantén el talón trasero abajo, los pies hacia delante y la rodilla trasera extendida.', 'Flexiona la rodilla delantera y cambia de lado.'], hold: '30 s por lado' },
  },
  {
    id: 'half-kneeling-hip-flexor-stretch', group: 'hip-flexors', muscle: 'Hip flexors',
    name: 'Half-kneeling hip-flexor stretch', target: 'Psoas and iliacus',
    instructions: ['Pad the back knee on a comfortable surface.', 'Tuck your pelvis and squeeze the glute of the rear leg.', 'Shift your hips forward with a neutral spine.'],
    hold: '30 s each side', image: '/stretching/half-kneeling-hip-flexor-stretch.png', width: 1344, height: 768,
    es: { muscle: 'Flexores de cadera', name: 'Estiramiento de flexor de cadera en media rodilla', target: 'Psoas e iliaco', instructions: ['Apoya la rodilla trasera sobre una superficie acolchada.', 'Haz una retroversión de pelvis y aprieta el glúteo de la pierna atrasada.', 'Desplaza la cadera al frente con la columna neutra.'], hold: '30 s por lado' },
  },
  {
    id: 'neck-side-stretch', group: 'neck', muscle: 'Neck',
    name: 'Lateral neck stretch', target: 'Levator scapulae and lateral neck',
    instructions: ['Sit tall and let your shoulders relax.', 'Tilt your head forward and slightly to the right.', 'Guide gently with your right hand while keeping the left shoulder down; switch sides.'],
    hold: '30 s each side', image: '/stretching/neck-side-stretch.png', width: 1344, height: 768,
    es: { muscle: 'Cuello', name: 'Estiramiento lateral de cuello', target: 'Elevador de la escápula y cuello lateral', instructions: ['Siéntate alto y deja los hombros relajados.', 'Inclina la cabeza hacia delante y ligeramente a la derecha.', 'Guía con la mano derecha de forma suave, manteniendo el hombro izquierdo abajo; cambia de lado.'], hold: '30 s por lado' },
  },
  {
    id: 'single-knee-to-chest-stretch', group: 'lower-back', muscle: 'Lower back',
    name: 'Single knee-to-chest stretch', target: 'Lower back and glutes',
    instructions: ['Lie on your back with your legs relaxed.', 'Draw one knee gently toward your chest.', 'Keep your pelvis and back relaxed, then switch sides.'],
    hold: '30 s each side', image: '/stretching/single-knee-to-chest-stretch.png', width: 1344, height: 768,
    es: { muscle: 'Zona lumbar', name: 'Rodilla al pecho', target: 'Zona lumbar y glúteos', instructions: ['Túmbate boca arriba con las piernas relajadas.', 'Lleva una rodilla suavemente hacia el pecho.', 'Mantén la pelvis y la espalda relajadas; cambia de lado.'], hold: '30 s por lado' },
  },
]

export const STRETCH_GROUPS = [
  { id: 'chest', label: 'Chest', es: 'Pecho' },
  { id: 'back', label: 'Back', es: 'Espalda' },
  { id: 'shoulders', label: 'Shoulders', es: 'Hombros' },
  { id: 'biceps', label: 'Biceps', es: 'Bíceps' },
  { id: 'triceps', label: 'Triceps', es: 'Tríceps' },
  { id: 'quads', label: 'Quadriceps', es: 'Cuádriceps' },
  { id: 'hamstrings', label: 'Hamstrings', es: 'Isquiotibiales' },
  { id: 'glutes', label: 'Glutes', es: 'Glúteos' },
  { id: 'calves', label: 'Calves', es: 'Pantorrillas' },
  { id: 'hip-flexors', label: 'Hip flexors', es: 'Flexores de cadera' },
  { id: 'neck', label: 'Neck', es: 'Cuello' },
  { id: 'lower-back', label: 'Lower back', es: 'Zona lumbar' },
]

export const stretchingImagePaths = STRETCHES.map(stretch => stretch.image)

export const STRETCHING_SAFETY = 'Warm up for 5–10 min; do not bounce; use mild tension and stop if pain appears. Do 2–4 repetitions where suitable.'
export const STRETCHING_SAFETY_EN = STRETCHING_SAFETY
export const STRETCHING_SAFETY_ES = 'Calienta 5–10 min; no rebotes; busca tensión leve y detente si aparece dolor. Haz 2–4 repeticiones cuando corresponda.'
