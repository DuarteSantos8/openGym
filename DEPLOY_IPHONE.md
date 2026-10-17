# 在 iPhone 长期使用 openGym：个人静态 PWA

## 审查结论与方案

2026-10-18 核对官方 `DuarteSantos8/openGym` HEAD：
`e348fc17c42c7e9a211c5972e573ad3698190ee2`，前端版本 1.4.1。
工作区原有 origin 指向个人 fork；已 fetch 官方 HEAD 并确认提交相同。

阅读 README、docs/MOBILE.md、SELF_HOSTING.md、FAQ.md，以及 frontend、
web/Dockerfile、docker-compose.yml、官方 Pages 工作流后，选择方案 A：
**GitHub Pages + 个人本地模式 + 官方 PWA**。不需要 Docker、Mac、域名或常开电脑。
这是一份个人使用的修改版 openGym，不是官方托管服务。

源码依据：

- `frontend/src/lib/demo.js`、`store/useStore.js`：官方 `VITE_DEMO=1` 在首次启动
  seed 示例计划、训练与体重，之后使用 localStorage；重置 Demo 会恢复示例。
  `.github/workflows/pages.yml` 原来构建这一模式。它不是云端个人账号。
- 默认 web build 会请求 `/api/config`、登录与同步 API；直接上传默认 dist 不等于独立 App。
- `VITE_MOBILE=1` 是 Capacitor 原生模式：依赖原生文件镜像、通知、分享和 onboarding，
  不能因为它无需服务器就把它当作 Safari 构建。
- 新增 `VITE_LOCAL=1`：提前进入原有 guest 数据路径，不 seed、不访问后端。
  设置页说明本地存储与备份；保留计划、逐组重量/次数、历史、统计和原 UI。
- `App.jsx` 用 HashRouter，`vite.config.js` 的 base 为 `./`，支持 Pages 的 `/openGym/` 子路径。
- 官方 `public/sw.js` 已提供版本缓存、离线启动、按需代码和媒体缓存、iOS 视频 Range；
  保留这一实现。Manifest 增加稳定相对 id；保留官方图标和 Apple touch icon。
- `store/useStore.js` 将训练状态持久化到 `gym_state_v1`，配有存储失败提示。
  `lib/media-store-idb.js` 保存个人媒体。原有 JSON/ZIP 导入导出继续使用。

| 方案 | 可行性和取舍 |
| --- | --- |
| GitHub Pages | 官方已有流程，免费公共仓库 + HTTPS，最少改动，本指南首选 |
| Cloudflare Pages | 同样可静态部署；仓库根运行 `npm --prefix frontend ci --ignore-scripts && npm --prefix frontend run build:local`，输出 `frontend/dist`，Node 22.12+；需核对当前文件数量/单文件限制 |
| Vercel | 同样可行；Root Directory 保持仓库根，使用上面的安装/构建命令及输出目录；Hobby 适用范围及配额以当期规则为准 |
| Docker + HTTPS | 保留账号、服务器备份、同步、推送及可选 AI；必须持续运行服务并持久化 `data/`。免费容器的休眠/临时磁盘不适合唯一训练副本；免费层不能保证长期稳定，暂不选用 |

原生通知、后台/锁屏休息提醒、服务器 Web Push、跨设备同步、账号/Passkey、管理后台、
服务器 AI 和需要后端代理的在线导入不在个人静态模式的保障范围内。
普通 CSV/JSON 导入和手动计划编辑可以本地运行。AI Demo 的预制回答不是实际 AI 功能。
训练时前台休息计时可用，iOS 挂起页面后不能承诺准时响铃。

## Windows 构建

若通过修改文件 ZIP 取得本次工程，先 clone 上游/自己的 fork，再将 ZIP 内文件覆盖到仓库根目录（基于上面的审查提交），不要仅上传 ZIP 本身。

安装 Git、Node.js **22.12 或更新的受支持版本（建议 Node 22 LTS）**。
下列命令在 PowerShell 使用，无需 Unix 风格环境变量：

```powershell
cd C:\path\to\openGym
npm --prefix frontend ci --ignore-scripts
npm --prefix frontend run build:local
npm --prefix frontend test
npm --prefix frontend run preview -- --host 127.0.0.1
```

`build:local` 自动设置 `VITE_LOCAL=1`、`VITE_DEMO=0`、`VITE_MOBILE=0`，禁用可选
Umami，并复制仓库中获许可的 180px 动作图片与视频。不需要密码、API Key、RP_ID、ORIGIN。
不要设置 APP_MEDIA_DIR（高分辨率原生 App 媒体不适用于网站）。
preview 仅供电脑检查；iPhone 不能使用电脑的 localhost，离线安装请用实际 HTTPS 地址。

## GitHub Pages 部署（需你登录操作）

1. 注册/登录 [GitHub](https://github.com)，使用自己的公共 openGym fork。
   将本工作区的修改提交并推送到自己的仓库 main；不要推送到官方仓库。
   此工作区已有 origin，可先用 `git remote -v` 检查是否为你的仓库。
2. 在仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
3. 本修改已将 `.github/workflows/pages.yml` 改为个人 PWA 构建。
   fork 若停用了 Actions，先启用，然后 Actions → Deploy personal PWA to GitHub Pages
   → Run workflow → main。自动触发仅 main 指定路径变化；手动运行可避免分支差异。
4. 等待 build 和 deploy 都成功，打开 deploy 输出的真实 page_url。
   项目站点通常是 `https://你的用户名.github.io/openGym/`；以实际输出为准。
   保留末尾 `/`。GitHub 提供 HTTPS，不需买域名。必要时 Pages 中启用 Enforce HTTPS。
5. 访问地址，确认是空白个人模式，而非示例历史；设置的 Account 页显示 Local data。
   如仍有样例，先核对发布的是本次构建；不要盲目重置已有个人数据。

提交示例（先检查 diff，不提交备份、密钥或 node_modules）：

```powershell
git status
git diff
git add frontend/src/lib/local.js frontend/src/lib/api.local.test.js frontend/src/lib/api.js frontend/src/store/useStore.js frontend/src/store/useStore.local.test.jsx frontend/src/views/Settings.jsx frontend/src/views/Login.jsx frontend/src/components/SyncBanner.jsx frontend/public/manifest.json frontend/scripts/build-local.mjs frontend/package.json .github/workflows/pages.yml DEPLOY_IPHONE.md
git commit -m "Add personal local PWA deployment for iPhone"
git push origin main
```

我没有替你登录、创建线上站点或验证公网部署；成功工作流和真实 iPhone 验收仍需你完成。

## iPhone 安装和验收

1. 使用最新稳定 iOS 的 Safari 打开上述 **固定生产 HTTPS URL**，不用无痕浏览。
2. 分享按钮 → 添加到主屏幕 → 若出现“作为网页 App 打开”，保持开启 → 添加。
3. 从新图标打开，后续始终使用此入口。不要依赖 Safari 标签页与主屏幕 App 共享数据；
   不同安装方式/系统版本可能有独立存储。正式使用前只创建少量测试数据。
4. 新建一个计划，添加动作，安排今天并完成训练，填写每组重量/次数；确认历史与统计。
5. 关闭 App 再从图标打开，检查计划和记录仍在。
6. 联网打开并等待资源缓存完成，再开飞行模式，彻底关闭后从图标重开：检查启动、
   计划、历史、录入一组和再次重开。恢复网络后再导出备份。
7. 导出测试备份并在另一个浏览器/设备导入，确认数据完整，再开始长期使用。

## 数据、备份和长期限制

- 训练状态：此站点 origin 下的 localStorage（`gym_state_v1`），个人照片/视频：IndexedDB。
  网站托管平台只保存程序和公开动作库，**不保存你的训练记录**，也不会替你备份。
- 每周以及每次重要训练后：Settings → Data & backup → Export backup (JSON)。
  在 iPhone 下载管理/分享中保存到“文件”→ iCloud Drive，并保留一份电脑副本。
  使用含日期文件名，保留多个版本。确认文件大小和内容，避免只保存网页链接。
- 有个人照片/视频时改用 Export with photos & videos (.zip)；JSON 不含这些文件。
  内置动作媒体由网站提供，无需备份。备份含健康隐私数据，不要上传到公共 Git 仓库。
- 恢复：在目标 App 中 Settings → Data & backup → Import backup，选择 JSON 或完整 ZIP，
  阅读合并/替换提示。替换前先导出现有数据。导入后核对计划、训练日期、次数与重量。
- Safari 静态 PWA 没有原生文件镜像和原生自动备份；备份是手动的，不能保证后台自动保存到 iCloud。
- 普通刷新和关闭不删除持久化状态；但清理网站数据、删除 App、存储压力/系统回收、
  设备遗失或损坏可能导致丢失。主屏幕安装能改善使用体验，**不能保证永不清理**。
  WebKit 对非安装网站的长期不活跃存储有额外策略；也不能把“七天”说成所有 PWA 的统一到期日。
- localStorage 常见上限约数 MB，具体由浏览器决定；多年大量历史可能触及配额。
  遇到存储失败提示立即导出，不要继续以为已保存。换 IndexedDB 也不能消除系统清理风险。
- 数据按 origin 隔离；更换 GitHub 用户名、域名、平台，或主屏幕安装身份变化前，先导出。
  同一 origin 下不要部署多个本地 openGym 实例：状态键相同，可能共享/混用数据。
- 官方 SW 离线保存 App shell、代码和已浏览媒体；主屏幕 App 会预取计划相关媒体，
  浏览器能识别的省流量/蜂窝网络可能跳过预取。媒体缓存约 150MB 上限，未缓存的动作图离线可能空白，
  但不影响文本训练记录。首次访问必须联网，部署更新后也需联网获取新版本。
- 更新前导出备份，合并上游时审查模式和数据格式；更新后复测离线启动。
  不要手动清理 SW/网站数据来“更新”，以免损失本地记录。

## 免费与许可

Pages 当前通常允许站点约 1GB、每月约 100GB 软带宽限制，另有构建/Actions 限额；
本次静态输出约 239MiB，包含 6554 张静帧和 6554 个动画，符合体积量级但需以平台当前规则为准。
个人使用通常无需费用；无可用性 SLA，平台政策和免费配额可能变化。
无需持续服务器，也无需 Windows 开机。iCloud 免费空间不足时需清理或自行选择其他备份存储。
公共仓库的源码和动作文件是公开的，个人训练副本不会因部署自动公开。

保留 LICENSE（AGPL-3.0-or-later）、NOTICE.md、catalogue/media/NOTICE.md 及上游作者声明。
网络提供修改版应向用户提供对应源码（使用公开 fork 即可）；高分辨率素材和动作图不随 AGPL 重新授权，
仓库 180px Gym visual 媒体限用于 openGym，不能提取用于其他产品。

## 本工作区实际验证

- `npm --prefix frontend run build`：通过（默认上游构建）。
- `npm --prefix frontend run build:local`：通过，输出 `frontend/dist`，动作媒体完整复制。
- `npm --prefix frontend test -- --maxWorkers=2`：403 个文件、5061 项测试通过。
  最后对新增持久化断言再跑本地模式 2 项测试，通过；相关 UI 回归 6 文件、75 项通过。
  默认不限制 worker 的首次运行已中止，改用双 worker 完成全套。
- `npm --prefix frontend run test:fatigue-probe`：108000 次比较及 1800 次历史删除比较通过。
- 无独立 `lint` npm 脚本；执行官方 `check-locales.mjs`（18 个 locale，每个 2258 keys）、
  `check-source-strings.mjs`（1770 字符串）与 `git diff --check`，均通过。
- 构建存在大 chunk / 无效动态拆包提示；完整测试有 MaxListenersExceededWarning，均未导致失败。
- 本地 HTTPS + Chromium、390×844 视口、实际 `/openGym/` 子路径：空白个人启动、UI 载入
  Full Body、开始训练、填入 40kg × 8 并标记完成、保存后生成 320kg 总量训练记录；
  SW 激活，断网刷新后记录仍在，统计页可打开，JSON 备份下载并导入全新浏览器成功，关闭页面后断网重新打开记录仍在；过程中无 `/api/` 请求和页面 JS 错误。
- 以上是桌面浏览器自动化，不等于真实 iOS Safari 测试；公网 HTTPS、GitHub Actions 执行、
  iPhone 主屏幕安装、真机离线和文件分享仍需按本指南验收。没有声称已上线。
