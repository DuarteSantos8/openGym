# Локальная разработка openGym на Windows

Проект: `C:\Users\illya\source\repos\openGym`. Рабочая ветка — `dev`;
`main` предназначена для проверенных изменений. `origin` указывает на
`https://github.com/illya228666/openGym.git`, `upstream` — на оригинал
`https://github.com/DuarteSantos8/openGym.git`.

## Запуск с hot reload

Открой PowerShell в папке проекта:

```powershell
cd C:\Users\illya\source\repos\openGym
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1
```

Открой <http://localhost:5173>. Frontend обновляется через Vite HMR; API
перезапускается через `node --watch`, Nutrition — через `dotnet watch`.
Нужен .NET 10 SDK; Ctrl+C останавливает все три процесса.
Логи находятся в `.local/api.log`, `.local/api-error.log`, `.local/web.log`
и `.local/web-error.log`, а также `.local/nutrition.log` и `.local/nutrition-error.log`. Занятые порты 3000/5080/5173 приводят к понятной ошибке,
а не к запуску ещё одной копии приложения.

Node.js **22.23.2** установлен из официального ZIP с проверкой SHA256 в
`%LOCALAPPDATA%\Programs\openGym-Node22\node-v22.23.2-win-x64`.
Эта папка добавлена в пользовательский PATH. После установки открой новый
PowerShell. Скрипты также находят эту копию напрямую, поэтому Node 24 из
среды инструментов не мешает запуску. Системные настройки других проектов
и глобальные npm-пакеты не менялись.

Зависимости установлены по lockfile для корня, `api/`, `frontend/` и `mcp/`.
Для web-разработки frontend установлен с `--ignore-scripts`: дополнительные
postinstall-инструменты генерации мобильных иконок ему не нужны. API установлен
с `--omit=optional`, как стандартный Docker-образ без AI runtime.

Локальный `.env.local` содержит:

```dotenv
RP_ID=localhost
ORIGIN=http://localhost:5173
API_ORIGIN=http://localhost:5173
PORT=3000
DATA_DIR=./data
TRUST_PROXY=0
```

API получает его через Node `--env-file`; Vite использует `API_ORIGIN` для
проксирования. Это важно для CSRF и passkeys: открывай именно `localhost`,
а не IP или другое имя. На Windows API сохраняет данные в папке проекта `data/`,
а не в системном `/data`. API слушает порт 3000 согласно исходному server.js;
Vite доступен на localhost:5173. Для серверного развёртывания используй nginx.

`frontend/.env.development.local` содержит `VITE_IMG_BASE` и `VITE_GIF_BASE`
с CDN jsDelivr, закреплённым на commit набора упражнений
`7455efae41b330c265e7cd4b78dfa848e7ce5ebd`. Медиа требует доступа к сети.
Эта настройка применяется только при разработке, не влияет на тесты или
production-сборку. Права на медиа описаны в `NOTICE.md`.

## Локальные проверки

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-windows.ps1
```

Скрипт проверяет web frontend, совместимые с Windows тесты API/MCP,
production-сборку, локализации, свойства модели усталости, импорты plain Node
и актуальность сгенерированного каталога, prompts и OpenAPI-страницы.

Полные исходные `npm test` не полностью совместимы с Windows:

- frontend: тест мобильного bundle предполагает POSIX-разделители пути;
- API: восемь файлов требуют POSIX chmod или запуска fixture по POSIX file URL;
- MCP: `state.test.js` проверяет Unix-права и семантику filesystem watcher.

Windows-скрипт явно исключает эти файлы; это **не полный regression run**.
Сами тесты и код приложения не изменены. Новый CI запускает все исходные
наборы на Ubuntu без этих исключений. Git for Windows предоставляет `sh`
для остальных shell-проверок. `.gitattributes` и локальная конфигурация Git
сохраняют LF; иначе byte-for-byte проверки генерируемых файлов дают ложные ошибки.

Проверено 9 октября 2026:

- frontend, 349 файлов: 4288 тестов прошли;
- API в Windows-скрипте: 472 теста прошли, 3 штатно пропущены;
- MCP tools: 83 теста и plain Node import graph прошли;
- Vite production build прошёл; предупреждения размеров chunks остались исходными;
- 17 локализаций по 1979 ключей синхронизированы;
- fatigue probe: 108000 сравнений и 14076 проверок удаления истории прошли;
- каталог, prompts и API-документация соответствуют исходникам;
- HTTP 200 на frontend, `/api/health` и `/api/config` напрямую и через Vite;
- в Chrome проверены гостевой вход, каталог 1324 упражнений и загруженная GIF-анимация;
- Compose-конфигурация валидна; API и Web образы локально собраны и запущены,
  `/api/health` отвечает, frontend отдаётся с HTTP 200.

## Docker Desktop

Docker Desktop **4.94.0**, Docker CLI **29.8.2**, Compose **5.5.1** и WSL
**2.7.13** установлены. После переустановки Docker Desktop Linux engine
запускается штатно.

```powershell
docker version
docker compose -f docker-compose.yml -f compose.local.yml up -d --build
docker compose -f docker-compose.yml -f compose.local.yml ps
Invoke-RestMethod http://localhost:8080/api/health
```

Приложение в Docker: <http://localhost:8080>. `.env` из `.env.example` уже
подготовлен с этим origin. Используй **оба** Compose-файла: локальное дополнение
собирает образы `opengym-api:local` и `opengym-web:local` из исходников вместо
загрузки приложения автора. Web публикуется только на 127.0.0.1:8080; API —
на 127.0.0.1:3000. Первый Docker-запуск скачает медиа в `media/`.
Nutrition собирается как `opengym-nutrition:local` и не публикует порт.
В Docker нет hot reload; после правки пересобери сервис той же командой.

Остановка:

```powershell
docker compose -f docker-compose.yml -f compose.local.yml down
```

Native API и Docker API используют порт 3000: останавливай один режим перед
запуском другого. `down` сохраняет локальные данные в `data/`.

## Подготовленный CI/CD

`.github/workflows/ci.yml` хранится в репозитории:

1. Push в `dev`/`main`, PR в эти ветки и ручной запуск запускают полные API/frontend/MCP тесты,
   frontend build, .NET 10 тесты и дополнительные проверки на Ubuntu с Node 22.
2. После тестов собираются API `api/Dockerfile` с target `default`, Nutrition
   `nutrition/Dockerfile` и Web `web/Dockerfile` с **корневым build context**
   (нужен `api/coach/core`).
3. Все три образа (API, Web, Nutrition на .NET 10) запускаются вместе; проверяются nginx, `/api/health`, `/api/config`, cookie/bearer запросы
   к Nutrition, подстановка имени и отзыв сессии.
4. Только push в `main` публикует прошедшие проверки образы в
   `ghcr.io/illya228666/opengym-{api,web,nutrition}`
   с тегами `latest` и `sha-<полный SHA>`. Пока готовится только linux/amd64.

Логин использует встроенный `GITHUB_TOKEN` с `packages: write`; личный токен
или пароль не нужны. Production-деплой и Proxmox здесь отсутствуют.
Новый workflow и все исходные GitHub workflows прошли `actionlint 1.7.12`;
реальный GitHub Actions run не выполнялся.

На GitHub Actions **пока отключены для форка**. Не включай их до попадания
подготовленных ограничений исходных workflows в `main`: исходный publisher
иначе мог бы публиковать образы без зависимости от новых тестов.
Локально publisher, Pages и исходные Tests ограничены оригинальным репозиторием;
Mirror уже имел такое ограничение. Для форка остаётся один новый CI.

После своего изменения: проверь его локально, просмотри `git diff`, самостоятельно
закоммить подготовку и свою правку в `dev`, отправь `dev` в `origin`, создай PR
**в main своего форка**. Проверь, что эти изменения уже доступны в `main`, перед
включением Actions через веб-интерфейс. Первый merge при выключенных Actions
сам не запустит CI: после включения можно выбрать Fork CI and GHCR → Run workflow
на ветке main. Ручной запуск проверяет тесты и образы, но ничего не публикует.
Чтобы проверить CI до слияния приложения, можно сначала отдельно перенести
только настройку workflows в main, включить Actions, затем открыть PR с правкой.
Эти действия оставлены тебе; коммиты, push, PR и публикация образов не выполнялись.

## Секреты и известные ограничения

Git и Docker build context исключают `.env`, `.env.*`, `data/`, `coach-auth/`,
`.local/`, зависимости, локальные ключи и сертификаты. `.env.example` остаётся
шаблоном в Git. API имеет собственный `.dockerignore`, поскольку его build context
не использует корневой файл. Не добавляй игнорируемые файлы через `git add -f`.

`npm audit` выявил предупреждения в **исходных lockfile**, включая high для API
`undici` и critical в дереве frontend. Отчёты находятся в `.local/*audit*.json`.
Это не исправлялось автоматически: обновление зависимостей требует отдельной
правки и полного Linux-тестирования перед production. Полный Linux CI пока не
запускался; локальная сборка и smoke-проверка двух Docker-образов прошла.

Справочные материалы: [Docker Desktop на Windows](https://docs.docker.com/desktop/setup/install/windows-install/),
[публикация Docker-образов из Actions](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).

## Nutrition (.NET 10)

Установи .NET 10 SDK. `scripts/dev.ps1` запускает сервис на localhost:5080,
Node проксирует `/api/nutrition/*`, а React открывает дневник питания с карточки
«Нутрициология» на главной странице. `scripts/check-windows.ps1` включает
.NET тесты. Docker запускает Nutrition без опубликованного порта.
Схема авторизации, команды обновления и проверки: [NUTRITION.md](NUTRITION.md).
