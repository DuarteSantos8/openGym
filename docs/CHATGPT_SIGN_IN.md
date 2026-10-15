# 以 ChatGPT 訂閱連接 AI Coach

本功能使用 Codex CLI 官方裝置碼登入，不需要 OpenAI Platform API key。請只在自己控制且信任的伺服器使用；ChatGPT 帳號必須具有 Codex 存取權，請求會使用該帳號的 Codex 額度並受方案與工作區限制。

## 登入

1. 依 SELF_HOSTING.md 建置 API 的 `coach` 目標，保留 `./coach-auth:/coach-auth` 掛載；預設映像不含 Codex CLI。
2. 使用自己的管理員 profile，在 Settings → Admin → AI Coach 啟用 Coach 並選擇 Codex。
3. 選擇 **Sign in with ChatGPT** → **Start device sign-in**。若已有 Codex API key，先明確移除它。
4. 在可信任的瀏覽器開啟顯示的 OpenAI 官方網址並輸入短效驗證碼，可用另一台裝置完成。必要時先在 ChatGPT 安全設定啟用裝置碼登入。不要在 openGym 輸入 ChatGPT 密碼。
5. 完成後選擇 **Test the Coach** 驗證一次真實模型回答。登入成功只表示 CLI 完成授權，不保證模型可用或尚有額度。

openGym 只顯示固定的 OpenAI 驗證網址、短效代碼與狀態，不提供原始 CLI 輸出或 OAuth token。發起登入的 profile 立即成為此個人訂閱唯一可使用者，管理頁的測試也遵守這項限制。既有 API key 與其他供應商保持相容；API key 費用與 ChatGPT 訂閱分開。

## 保存與登出

Codex 在 `/coach-auth/auth.json` 管理可更新的登入憑證；`coach.json` 只保存種類、時間與 profile 綁定。`coach-auth` 位於 `data` 之外，只掛載 API，不提交 Git、不納入一般健身資料備份。重啟可沿用此專用快取，不讀取宿主機 Codex 登入。

關閉登入畫面或選擇 Cancel sign-in 會取消未完成流程；伺服器亦有十分鐘期限。切換供應商或停用 Coach 會取消未完成登入。已完成的連線透過 Credential → Remove 登出，這會呼叫 Codex logout 並移除專用快取。切換 API key 與訂閱時先移除原連線，避免默默改用不同計費來源。

授權撤銷或模型回報登入錯誤時，移除後重新登入；快取存在本身不是線上有效性的證明。重啟會終止未完成流程，未綁定快取不會自動授權任何 profile。

## 來源

參考改寫自 [alexpcosta/opengym 裝置碼登入](https://github.com/alexpcosta/opengym/blob/678bf5bf10446e8997a77d43e89c9b2721d8d0fc/api/coach/oauth.js)，保留新版每供應商設定與個人訂閱隔離。官方文件：[Codex authentication](https://learn.chatgpt.com/docs/auth)。
