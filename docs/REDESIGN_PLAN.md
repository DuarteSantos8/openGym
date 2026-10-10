# REDESIGN_PLAN — openGym « Liquid Glass » + Coach IA

> Phase 1 — Audit et plan. Aucun fichier de code n'a été modifié dans cette phase.
> Base analysée : branche `main` @ `b1cff630` (v1.4.0, 2026-10-09), clonée sur `feature/liquid-glass-ai`.
> Dépôt source : `github.com/DuarteSantos8/openGym` (8527 ⭐, AGPL-3.0). L'APK fourni (`~/Téléchargements/openGym.apk`, 301 Mo) est issu du même codebase via Capacitor.

---

## 1. Cartographie du frontend

### 1.1 Point d'entrée et routage

- **`frontend/index.html`** : `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">` (l.5), `<meta name="theme-color" content="#0c0e12">` (l.19). Thème initial injecté avant le premier rendu attendu en JS.
- **`frontend/src/main.jsx`** : `createRoot(...).render(<StrictMode><App/></StrictMode>)` (l.13-15) ; démarre `startMediaSync`, `startNativeKeyboard`, et enregistre le service worker `sw.js` (l.26-27) **uniquement si HTTPS et hors mobile**.
- **`frontend/src/App.jsx`** : notre **`App`** rend `Shell` (l.258) dans un **`<HashRouter>`** (l.2, react-router-dom 7). À `Shell` :
  - Layout général (l.180-205) : états Login / MobileOnboarding hors `<Routes>`.
  - **Routes** (l.206-232) :

| Route | Composant | Remarques |
|---|---|---|
| `/home` | `Home` | salutation, séance du jour, poids |
| `/checkin` | `CheckIn` | si `S.checkIn !== false` (l.210) |
| `/plan` | `Plan` | semaine + bandeau 7 jours |
| `/plan/r/:id` | `RoutineEdit` | éditeur de routine |
| `/workout` | `Workout` | séance guidée plein écran |
| `/stats` | `Stats` | heatmap, records, 1RM |
| `/history` | `History` | historique |
| `/library` | `Library` | bibliothèque d'exercices |
| `/muscles` | `Muscles` | carte des muscles |
| `/structural-balance` | `StructuralBalance` | équilibre musculaire |
| `/progress-photos` | `ProgressPhotos` | photos de progression |
| `/measurements` | `Measurements` | mensurations |
| `/settings`, `/settings/:page` | `SettingsRoute` | paramètres |
| `/coach*` | `CoachChat`, `CoachIntake`, `CoachSetup` | assistant IA |
| `/admin` | `Admin` | si `user.admin`, sinon redirige |

  - Restauration de scroll manuelle (l.155-175) ; `noTabs` masque la tab bar (l.188, 240).
- **Thème** (l.56-67) : `resolveTheme()` = `'light'|'dark'|'system'` ; `applyPrefs()` pose `document.documentElement.dataset.theme` et appelle `applyAccent`. Écouteur `matchMedia` actif seulement si `S.theme==='system'` (l.105-111). `theme-color` dynamique : `#f2f2f7` clair / `#000000` sombre (l.64-65).

### 1.2 Stores Zustand

- **`frontend/src/store/useStore.js`** : `create(...)` (l.308). État retourné (l.1299-1316) : `S, user, ready, sync, config, needsMobileOnboarding, linkCode, coachLocal, keptRev`. `S` = `DEF` (l.87-240) : surcharge de clés planifiée manquante... les clés réelles : `unit, restSec, sound, theme:'dark', accent:'lime', body, bodyweight, routines, week, dayPlan, dayNotes, measurements, queue, rotation, scheduleMode, exWeights, workouts, active, customEx, workoutView, exerciseView, wc, hints, reminder, equipProfiles, exNotes, favEx, weekStart, wdec, speedUnit, barWeights, plates, loadKind, dbLoad, dumbbells, gymCards, checkIn, showWeightCard, weighIn, connStatus, startFrom, enParens, enOnly, logRef, balanceTemplate, balanceOverrides`. Actions (l.1299-1978) : `update, setUnit, resetEverything, import*, backup*, setGuest, loadConfig, refreshConfig, setUser, pushState, pullState, syncNow, adopt*, signOut*, chooseLocalMode, connect/disconnect, resetDemo, boot, setCoachLocal, save/discard/deleteHistoryEdit`.
- **`frontend/src/store/useUI.js`** : `create` (l.208). Clés `sheets, toastMsg, toastAction, swipeHint, setFlash, timer, work`. Actions `flashTimer, openSheet, closeSheet, closeAll, toast, runToastAction, pause/resumeToast, start/pause/resume/addRest, shiftRestOwner, followNativeRest, stopRest, startWork, bindWork, finishWorkEarly, abandonWork, stopWork`. Persist `REST_KEY='gym_rest'` (l.451), `WORK_KEY='gym_work'` (l.490).

### 1.3 Composants réutilisables (inventaire)

Fichiers dans **`frontend/src/components/`** :

| Fichier | Composants | Rôle |
|---|---|---|
| `ui.jsx` | `Button`(238 usages), `Row`(150), `Section`(46), `Stepper`(45), `Switch`(51), `Segmented`(26), `SelectRow`(13), `MultiSelectRow`(2), `NumberField`(11), `TextField`(11), `TextArea`(5), `SearchField`(2), `Slider`(3), `Check`(3) | primitives contrôlées `(value,onChange)`, CSS `.btn .field .num .sw .seg .stp .sld .chk .sect .lrow`, cibles ≥44px |
| `Modals.jsx` | `Sheet` (unique, id `#modal-root`) : `viewer`/`center`/bottom-sheet (`.<sheet>`+`.grab`+`.mback`) ; swipe-dismiss (delta>90px ou vy>0.6), `locked`, pin `body`, push history (back/Échap) | modales & bottom sheets |
| `TabBar.jsx` | `<nav id="tabbar">` 5 onglets : Home, Plan, **Start/Resume central** (`/workout`), Stats, Exercises | navigation basse |
| `Toast.jsx` | toasts + action | retours utilisateur |
| `LineChart.jsx` | SVG maison (`viewBox 340×h`, polylines+gridlines+dégradé, tooltip `.ctip`) | graphiques poids/1RM |
| `Heatmap.jsx` | grille CSS (`.hm-col/.hm-c .l0–l4`) | heatmap d'activité |
| `BodyMap.jsx`, `MuscleExplorer.jsx`, `StructuralBalance.jsx`(view) | cartes musculaires | muscle map |
| `Icon.jsx` + `lib/glyphs.js` | **115 icônes SVG** inline (grille 24, `currentColor`, `--icon-stroke`) + 20 glyphs de routine + map legacy-emoji (~40) | icônes |
| `RestTimer.jsx` | minuteur de repos capable de se "docker" (`.dock`) | timer |
| `SwipeRow.jsx`, `WorkoutChips.jsx`, `Stepper.jsx`, `NumField.jsx`, `DurationWheel.jsx`, `Elapsed.jsx`, `TimerFlash.jsx`, `QueueRow.jsx`, `SyncBanner.jsx` | diverses interactions | divers |
| `Media.jsx`, `WorkoutMedia.jsx`, `WorkoutThumb.jsx`, `media-*` lib | médias/démos d'exercices, lazy | médias |

### 1.4 Vues principales (`frontend/src/views/`)

`Home.jsx`, `CheckIn.jsx`, `Plan.jsx`, `RoutineEdit.jsx`, `Workout.jsx`, `Stats.jsx`, `History.jsx`, `Library.jsx`, `Muscles.jsx`, `StructuralBalance.jsx`, `ProgressPhotos.jsx`, `Measurements.jsx`, `Settings.jsx` + `settings-pages.js`, `Admin.jsx`, `Login.jsx`, `CoachChat.jsx`, `CoachIntake.jsx`, `CoachSetup.jsx`, `MobileOnboarding.jsx`.

Fichiers CSS isolés : `FocusView.css`, `admin.css`, `coach.css`.

---

## 2. Inventaire du style

### 2.1 Méthodologie CSS actuelle (décision sans changement)

**Le projet n'utilise PAS CSS Modules ni de preprocesseur.** C'est du **CSS global en fichiers plats** :
- `frontend/src/index.css` — **2136 lignes**, feuille globale principale (everything).
- `frontend/src/views/*.css` (`FocusView.css`, `admin.css`, `coach.css`) — feuilles secondaires.
- Styles inline dans JSX réservés aux valeurs dynamiques (positions, progressions).

→ **On reste sur du CSS global.** Les tokens s'ajoutent via `frontend/src/styles/tokens.css` importé en premier, sans changer de méthodologie ni reformater les fichiers existants. (Cohérent avec le point d'entrée `main.jsx`.)

### 2.2 Définition des thèmes et accents

Tout est dans **`index.css`** :
- `:root` (l.20-70) : thème **sombre par défaut** — `--bg:#000000; --bg-el:#0e0e10; --surface…` ; labels `--label-*` en `rgba(235,235,245,.60/.32/.18)` ; séparateurs `--sep/--sep-op` rgba(84,84,88,…).
- `:root[data-theme="light"]` (l.72-92) : `--bg:#f2f2f7; --bg-el:#f7f7fa; …` labels `rgba(60,60,67,…)`.
- `:root[data-accent="…"]` (l.95-102) : **8 accents fixés** — lime, sky, orange, violet, pink, red, teal, gold, chacun posant `--acc`, `--acc-2`, `--on-acc` (+`--knob-ring` pour gold). Valeurs des palettes (l.40-42 sombre, l.87-89 clair, `--green/--blue/...`).
- Corrections contrastes clair (l.109-114). Existe `:root[data-accent="custom"]` + vars inline géré dans `lib/accent.js`.

### 2.3 Couleurs codées en dur (à migrer vers tokens)

**`index.css` — hexadécimales hors variables** (grep « `#[0-9a-f]{3,6}` », 120 occurrences dans index.css) — extrait :

| Ligne | Valeur | Contexte probable |
|---|---|---|
| 30-32 | `rgba(235,235,245,.60/.32/.18)` | `--label-2/3/4` (déjà en token) |
| 35-36 | `rgba(84,84,88,…)` | `--sep`, `--sep-op` (déjà en token) |
| 40-42 | `#0a84ff #30d158 ...` | palette `--green/--blue/...` (déjà en token) |
| 402 | `rgba(249,249,251,.94)` | fond tab bar clair |
| 581,665,674,732 | `rgba(118,118,128,.12)` | fonds champs/segments clair |
| 503 | `rgba(0,0,0,.22)` | shadow drag row |
| 214,312,440,443,475,493,508,521,543,586,708,741,820,881,886,890,909,912,914,916,971 | `#…` courts (profondeur) | ombres, bords, hachures |
| 455+ | commentaires `@supports` — à conserver |

Hors `index.css` : **1 hex** dans `FocusView.css`. Les tests JSX (`Settings.accent.test.jsx:#FF00AA` etc.) sont des données de test → **exceptions légitimes**.

**Couleurs des muscles de la muscle map** : définies comme tokens `--muscle-*` **à créer** (redesign de `Muscles.jsx`/`BodyMap.jsx`).

---

## 3. Composants réutilisables — statistiques d'usage

Tableau complet des primitives et de leurs comptages : voir 1.3 (comptages issus de grep JSX, chiffres réels : Button 238, Row 150, Switch 51, Section 46, Stepper 45, Segmented 26…). Aucun composant « Card » générique n'existe ; les cartes sont des `<section class="sect">` / `.lrow` dans les vues.

---

## 4. Navigation

- **Tab bar** : `<nav id="tabbar">` dans `TabBar.jsx`, `position:fixed; bottom:0; z-index:50` (`index.css:394-401`), fond blur existant (`saturate(180%) blur(10px)`) avec `@supports` fallback (l.398-402, 448-456), `padding-bottom` `--sab` (safe area). 5 onglets : Home, Plan, Start(center `/workout`), Stats, Exercises. Actif = `loc.pathname.split('/')[1]`, alias (`history→stats`, `settings→home`, `muscles→library`, `structural-balance→stats`).
- **Sidebar desktop** : inexistante aujourd'hui (3.6 demande d'en créer une ≥900px).
- **Thème** : porté par `data-theme` sur `<html>` (déjà le cas, l'objectif cible est respecté) + `data-accent`. `theme-color` meta déjà dynamique (noir sombre / `#f2f2f7` clair) — à passer à `#F5F5F7` per spec 2.1.
- **Safe areas** : `viewport-fit=cover` déjà en place ; `--sab`/`--sab` inset utilisés (l.173, 390+).
- **Scroll restore** manuel (App.jsx).

---

## 5. Bibliothèque de graphiques

**Aucune librairie.** `LineChart.jsx` = SVG cousu main ; `Heatmap.jsx` = grille CSS. Créer `--muscle-*` tokens et restyler via CSS/tokens directement. → Pas de dépendance à changer.

---

## 6. Capacitor / WebView Android

- `frontend/capacitor.config.json` : `appId ch.duartesantos.opengym`, `webDir dist`, `backgroundColor #0c0e12`, `android.allowMixedContent: true`. `minSdkVersion 23` (Android 6+).
- `frontend/package.json` : plugins `@capacitor/core, app, filesystem, local-notifications, share`, `@aparajita/capacitor-secure-storage`, `@capacitor-mlkit/barcode-scanning`, `jsqr`, `lean-qr`. `build:mobile` = `VITE_MOBILE=1 vite build && stage-media && cap sync && check-mobile-bundle`.
- `index.html` : `viewport-fit=cover` OK ; `theme-color` l.19.
- `MOBILE.md` : pas de version minimale de WebView documentée — **à ajouter dans la phase 3/7** (préconisation : Chrome 77+ pour `backdrop-filter` stable ; les anciennes WebView retombent sur le fallback `@supports`, déjà présent dans le code).
- Détection `MOBILE` dans le build : `MOBILE` flag via `VITE_MOBILE` (serveur absent → IA masquée).

---

## 7. i18n

- **`frontend/src/lib/i18n.js`** + `i18n-core.js`. **20 langues déclarées** (`LANGS`), **18 fichiers de locale présents** dans `frontend/src/locales/` : ar, bn, de, es, fr, hi, hu, it, ko, pl, pt, pt-BR, ru, th, tr, uk, zh, zh-TW (en = fichier vide par défaut, de-CH dérivé de de).
- **Ajouter une chaîne** : la clé **EST la phrase anglaise** — `t('English sentence')` (ou `tn(one, other, n)` pour pluriels, valeurs par catégorie CLDR `{one,few,many}`). Packs plats `{source: target}`.
- **Chargement** : lazy via `import.meta.glob` ; le bundle ne contient que l'anglais. RTL : `{ar}`.
- Contrôle qualité locale : `locale-coverage.test.js`.

---

## 8. Risques / zones fragiles (stratégie)

| Zone | Fichier | Risque | Stratégie |
|---|---|---|---|
| **Séance guidée** | `Workout.jsx`, `Workout*.test.*`, `CheckIn.jsx` | écran critique, mains en sueur, une main | restylage minimal + fonctionnel ; **ne pas** toucher le flux d'états ; tests séance déjà nombreux (garder verts) |
| **Minuteur de repos** | `RestTimer.jsx` (+ `.dock`, `useUI` rest) | persistance `gym_rest`, dock en verre cible | restyle du conteneur uniquement, logique intacte |
| **Wake lock** | `lib/wakelock.js` | écran allumé pendant séance | inchangé |
| **Service worker / PWA** | `sw.js` (racine frontend), `main.jsx:26` | cache des assets, mise à jour PWA, subpath | vérifier versioning de cache SW pendant la phase 7 pour ne pas bloquer le nouveau design |
| **Bottom sheets** | `Modals.jsx` | piège de focus/scroll | restyle + garder l'API `onSheet…` existante |
| **Safe areas** | `--sab`, `viewport-fit=cover` | encoche Android/iOS | conserver, tester avec `viewport-guard` |
| **Migration data** | `store/useStore.js` `DEF` ; serveur `_rev/_ts` | aucune clé `version` dans le state actuel | ajout d'une clé `version` + fonction de migration pure **testée** (rétrocompatible) |
| **Performance listes** | `Library.jsx`, `History.jsx`, heatmap | blur sur listes | verre translucide SANS blur (3.6) |
| **Détection `MOBILE` / IA serveur** | `MOBILE` flag, `coach-local.js` | IA masquée hors serveur | l'IA back-end dépend d'une instance ; le build APK contient `coach-local` (phone BYOK) |

### Trouvaille importante : **un coach IA existe déjà** (ne pas réinventer)

- **Backend** : `api/coach/` — `routes.js` (disclosure, status, plan, review, debrief, cohort, pending/resolve, forget, account, admin/coach/*) ; `jobs.js` (jobs fichier-backed, caps `perProfileDaily:10`/`instanceDaily:0`) ; `config.js` (fournisseurs : **fixture, claude, codex, openai, gemini, compatible**) ; pipelines `/api/coach/*` ; `core/` (pipeline, prompts, parse, validate, schemas, providers, payload, library, plan-hash, refine-changes) ; `adapters/` (claude, codex, spawn) ; `prompts/*.md` (create/refine/review/debrief/repair, sortie JSON strictement). Schéma de plan : `coach_contract/opengym_plan{name,summary,baseOn,week,routines[].ex[]…,customEx}`.
- **Pas de streaming** : jobs polycyclés (`coach-api.js` POLL_MS 3000/IDLE 60000), répondus par polling. Pas de route `/api/ai/*`.
- **Frontend** : `CoachChat.jsx` + `coach.css`, `CoachIntake.jsx` (profil), `CoachSetup.jsx` (connexion fournisseur), `lib/coach*.js` (apply/revert `CONSENT_VERSION 2`, `LOG_MAX 50`, `CHAT_MAX 40`), `coach-local.js` (BYOK Android, cap `LOCAL_DAILY_CAP 10`).
- **Décision Enregistrée** : les phases 5-6 de la mission (« assistant IA ») deviennent **« refonte & durcissement du coach existant »** plutôt qu'une création ex nihilo. Le backend reste Node sans framework, la clé reste serveur/`.env`/`coach-auth`, le streaming est un **renforcement optionnel dans la phase 6** (en préservant le mode polling actuel comme fallback offline).

---

## 9. Plan par phases (avec estimation et ordre)

> Ordre strict demandé : audit → tokens → verre → structure → backend IA → frontend IA → qualité/docs. Chaque fin de phase : `npm test` vert, `vite build` OK, `docker compose build` OK, commits atomiques `feat(scope): …` en impératif, résumé + façon de tester.

| Phase | Contenu | Taille | Commits type |
|---|---|---|---|
| **1 — Audit** (cette doc) | cartographie, inventaire, risques | M | `docs: add liquid-glass redesign plan (audit)` |
| **2 — Tokens** | `frontend/src/styles/tokens.css` ; migration `data-theme`/`data-accent` ; token monochrome par défaut ; `--muscle-*` ; inline script anti-flash dans `index.html` ; grep des couleurs → tokens | L | `feat(style): add design tokens` · `feat(style): migrate hardcoded colors to tokens` |
| **3 — Liquid Glass** | `styles/glass.css`, `components/Glass/Glass.jsx`, `AmbientBackground`, `GlassTabBar`, réfraction SVG (progressive, `data-refract`), table 3.6 appliquée, fallbacks `@supports`/reduced* | XL | `feat(ui): add glass primitives` · `feat(ui): glass tab bar` · `feat(ui): apply glass surfaces` · `feat(ui): ambient background` |
| **4 — Structure fluide** | héros par écran, large titles, listes sans boîtes, one-hand workout, transitions `startViewTransition`, haptics (`lib/haptics.js`), responsive (±900px sidebar) | XL | `feat(ui): page heroes & spacing` · `feat(ui): guided workout redesign` · `feat(ui): view transitions` · `feat(ui): haptics` |
| **5 — Coach IA backend** | adapter `api/coach` : `validatePlan` pur testé, rate-limit mémoire testé, contexte `buildCoachContext`, sécurité prompts `<user_data>`, nginx streaming (si activé), `.env.example` | L | `feat(api): plan validation` · `feat(api): coach rate limits` · `feat(api): coach context builder` |
| **6 — Coach IA frontend** | restyle `CoachChat` (`coach.css`→glass), consentement explicite, diff plan + apply/revert (pur, testé via `lib/coach.js`), `applyPlan` test, streaming SSE optionnel, i18n | L | `feat(ui): coach chat glass` · `feat(coach): plan diff & apply/revert` · `feat(coach): streaming response` |
| **7 — Qualité & docs** | perf (code-splitting IA, lazy media), a11y, compat (capacitor/WebView, MOBILE.md), migration rétrocompatible testée, docs/README/CHANGELOG, captures avant/après dans `docs/screenshots/` | M-L | `chore: performance` · `chore: a11y` · `docs: redesign completion` |

### Est-ce que des étapes posent question ?
- **AI streaming** : l'existant est en polling. L'ajout de SSE est optionnel (préservé en fallback). À valider en phase 6.
- **`prefers-color-scheme` + flash** : l'état du thème vit dans le store (persisté). Script inline dans `index.html` requis pour éviter le flash au boot.
- **Les muscles** : couleurs actuelles à inventorier exactement dans `Muscles.jsx`/`BodyMap.jsx`/`lib/body-paths.js` au démarrage de la phase 2, avant de créer `--muscle-*`.

---

## 10. Critères d'acceptation (rappels branchés au réel)

- [ ] Aucune couleur hors `tokens.css` (grep de contrôle, exceptions test + gradients de demo documentées).
- [ ] Toutes les fonctionnalités de 0.1 restent intactes (checklist manuelle finale dans ce doc).
- [ ] Verre sur toutes les lignes du tableau 3.6 du cahier des charges, fallbacks vérifiés `data-refract="off"`.
- [ ] Coach IA existant durci (pas recréé), plan validé, diff, apply puis annulable ; historique restauré par rollback `applyPlan`.
- [ ] Migration rétrocompatible : clé `version` ajoutée, anciens `state-*.json` lisibles identiques après migration.
- [ ] `npm test`, `vite build`, `docker compose build` verts à chaque fin de phase.

*Fin de document — Phase 1 n'a modifié aucun fichier de code.*
---

## Phase 2 — Terminée (commit feat/style)

**Fichiers** : `frontend/src/styles/tokens.css` (nouveau), `frontend/src/index.css`, `frontend/src/main.jsx`, `frontend/index.html`, `frontend/src/lib/format.js`, `frontend/src/lib/accent.js`, `frontend/src/views/FocusView.css`, `frontend/src/admin.css`, 18× `locales/`.

**Résultats** : 5038 tests ✓ · build ✓ · zéro couleur hex/rgb hors tokens.css (grep contrôlé — exceptions documentées : mask-image alpha en `#000`, conic-gradient remplacé par les variables système).

**Décisions notables** :
- **Monochrome par défaut** : `--accent` = blanc (sombre) / noir (clair) ; `DEFAULT_ACCENT='mono'` ; `ACCENTS.mono='#8e8e93'` (neutre pour le swatch Settings, visible dans les 2 thèmes). Les 8 accents Apple restent inchangés.
- **Alias de compatibilité** : `--bg`, `--surface`, `--label`, `--acc`, `--r`, `--fast`… → tokens sémantiques. Zéro régression sur les composants existants.
- **Anti-flash** : script inline dans `index.html` (lit `gym_state_v1`, applique `data-theme` + `theme-color` avant le premier rendu).
- **Muscles** : `--muscle-base`, `--muscle-l1…l4` tokens (remplacent `--bm-base` + `color-mix` en dur).
- **Exrceptions légitimes** : mask-image (alpha), ombres internes SVG.
