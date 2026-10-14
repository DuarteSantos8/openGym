# End-to-end (e2e) tests for web

Browser end-to-end tests for openGym, authored with [KaneCLI](https://www.testmuai.com/kane-cli/) by TestMu AI. Each test is a plain-English `_test.md` file; KaneCLI runs it in a real Chrome browser and records each step so later runs replay without re-authoring.

| Test | What it covers |
|---|---|
| `starter_plan_test.md` | Continuing as a guest, loading the Full Body starter plan, and checking the weekly schedule |
| `body_weight_test.md` | Logging a body-weight entry from the home screen |
| `workout_test.md` | Starting a workout, logging a set, finishing early and saving, and seeing it counted on the home screen |

All three run in guest mode (`ALLOW_GUEST`, on by default), so they need no account and every run starts from an empty browser.

## Run the tests

Start openGym on `http://localhost:8080`:

```bash
cp .env.example .env
docker compose up -d --build
```

### With KaneCLI

```bash
npm install -g @testmuai/kane-cli
kane-cli login
kane-cli testmd run e2e/kane/starter_plan_test.md --agent
kane-cli testmd run e2e/kane/body_weight_test.md --agent
kane-cli testmd run e2e/kane/workout_test.md --agent
```

### With the exported Playwright code

Each test also has an exported Playwright (JavaScript) version under `output-<test>/playwright-javascript-code/`:

```bash
cd e2e/kane/output-workout/playwright-javascript-code
npm install
npx playwright install chromium
node test.js
```

Copy `.env.example` to `.env` and fill in your TestMu AI (LambdaTest) credentials first.

## Editing a test

Edit the step text in the `_test.md` file and run it again with `kane-cli testmd run`. Changed steps (and the steps after them) are re-recorded; unchanged steps replay from `output-<test>/`.
