# openGym for Huawei watches

The watch app for Huawei "lite wearable" watches (Watch GT 2 to 6, Watch Fit family): start a
routine, log sets, rest with a ring, see the summary. It speaks the Garmin watch's messages over
Huawei's Wear Engine, through the phone app. Pages are HML + CSS + JS in a tiny JavaScript engine,
built with Huawei's DevEco Studio. Nobody has run it on a watch yet: see
[docs/HUAWEI_WATCH.md](../docs/HUAWEI_WATCH.md) for building, installing and what is still unchecked.

## Where things are

```
entry/src/main/config.json                    app id, version, permissions, the phone's package and fingerprint
entry/src/main/js/MainAbility/
  app.js, i18n/en-US.json                     the app shell
  pages/index/                                the one page: index.hml, index.css, index.js (glue only)
  common/core.js                              the logic: the Garmin watch's Core/Actions/Link as plain JS
  common/view.js                              what each screen shows and what each tap does
  common/frames.js, radio.js                  1 KB message framing and the Wear Engine send/receive
  common/store.js                             the state in the watch's files, safe against being killed
  common/texts.js                             the words, 26 languages (generated, do not edit)
  common/wearengine.js                        Huawei's own SDK file, Apache-2.0, unchanged
huawei-strings.mjs                            writes common/texts.js
test/                                         Node tests for everything above except wearengine.js
```

Everything that can be plain JavaScript is, and runs under Node. Only `pages/index/index.js` and
`wearengine.js` touch Huawei's APIs.

## The phone's package

`PHONE_PACKAGE` in `pages/index/index.js` is the release phone app (`ch.duartesantos.opengym`). A debug
phone build is `ch.duartesantos.opengym.test`: set that, and the same pair in `config.json`'s
`supportLists` (a test checks they agree), to try the watch against one.

## Tests

```bash
cd watch-huawei && npm test      # node's own runner, no install needed
```

`test/syntax.test.js` holds every source file to the language subset the lite engine promises
(no classes, spread, destructuring, template strings, `find`, `includes`, ...).

## The words

The watch says what the Wear OS watch says, plus a few phrases of its own. After changing any of
those, regenerate and commit the result (a test fails when `texts.js` is out of date):

```bash
node watch-huawei/huawei-strings.mjs
```
