# EP-04 rebase mapping

Rebased cleanly onto `470defb7f524299e7c148dae3799d87eb27a9c82` with `git pull --rebase origin next/integration`.
No conflict resolution or new runtime edits. Recorded test/build/browser hashes refer to the pre-rebase commits.

| Before rebase | After rebase | Subject |
| --- | --- | --- |
| `23e0c248` | `80a074a8` | docs: confirm EP-04 diary implementation and verification plan |
| `81777172` | `df7d7b95` | test: specify nutrition snapshots and visible diary reducers (RED) |
| `314bb3f4` | `5f471958` | feat: add bounded nutrition snapshots and visible diary reducers |
| `58797b0b` | `75a0738f` | test: expose diary-only guest adoption loss and misleading prompt (RED) |
| `393c4bbc` | `b91e1cf6` | fix: offer and preserve diary-only guest data on sign-in |
| `f646fa66` | `4c96c6f0` | test: retain account foods logged during pending adoption (RED) |
| `412f549a` | `c374ead7` | fix: keep account diary additions across delayed guest adoption |
| `63579a41` | `5037cb79` | test: specify gated diary CRUD and future-schema UI (RED) |
| `41571761` | `0e99d412` | fix: use nutrition UUID in adoption inventory split |
| `e86321df` | `04f10925` | feat: ship opt-in local nutrition diary with entry totals and undo |
| `c3333034` | `7285a919` | test: reproduce stale food sheet across module and account changes (RED) |
| `19757ab9` | `a86839fd` | fix: dismiss diary sheets when module or account access changes |
| `88af0d60` | `a677e5cd` | test: expose wrapped nutrition total at 200 percent RTL text (RED) |
| `180773ba` | `b0dc3a0c` | fix: adapt diary summary columns to enlarged text |
| `4387f0d6` | `9c8e9a17` | test: expose invisible diary rows with invalid or missing days (RED) |
| `4d87fc32` | `f2735ac8` | fix: expose undated nutrition rows without changing their saved day |
| `12b6df1e` | `d8e4a2fb` | test: reproduce malformed rows and delayed empty-account adoption (RED) |
| `5eff5a5c` | `6fb42d73` | test: expose optional stamping dropping malformed retained elements (RED) |
| `4bb2dbd7` | `ffe32083` | fix: preserve diary edits and validate opaque retained records |
| `fb1fe1b1` | `d573a23d` | test: expose nutrition precision following workout display preference (RED) |
| `fe22da11` | `0ac5cbc8` | fix: format nutrition to three decimals independently of workout weights |
| `a1639383` | `578a1f5f` | test: verify volume backups and older writers with opt-in Tour defaults |
| `856e0d3e` | `578691eb` | docs: retain EP-04 browser and correction verification evidence |

## Source identity

29 of 48 EP-04 source/test files are byte-identical to reviewed `a1639383`.

Shared files also changed upstream:
- `frontend/src/locales/ar.js`
- `frontend/src/locales/bn.js`
- `frontend/src/locales/de.js`
- `frontend/src/locales/es.js`
- `frontend/src/locales/fr.js`
- `frontend/src/locales/hi.js`
- `frontend/src/locales/hu.js`
- `frontend/src/locales/it.js`
- `frontend/src/locales/ko.js`
- `frontend/src/locales/pl.js`
- `frontend/src/locales/pt-BR.js`
- `frontend/src/locales/pt.js`
- `frontend/src/locales/ru.js`
- `frontend/src/locales/sv.js`
- `frontend/src/locales/th.js`
- `frontend/src/locales/tr.js`
- `frontend/src/locales/uk.js`
- `frontend/src/locales/zh-TW.js`
- `frontend/src/locales/zh.js`

All 19 Nutrition locale blocks are byte-identical to the reviewed version. Upstream adds three Stats strings in another block.

The rebase also retains four inherited, pre-assignment parent commits: `1785516f` (resumption plan/progress), `ac93dc67` (resumption evidence), `e5d92eb0` (EP-05b brief), `16e14c1e` (ignore worktrees). These were present in supplied base `be8fc9bf`; EP-04 did not author or edit them.
