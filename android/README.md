# OpenGym Android 客户端

[gym.litaku.cn](https://gym.litaku.cn) 的 Android 原生壳应用，基于 WebView 封装，支持 Passkey 生物识别登录。

---

## 功能

- **Passkey 支持**：通过 Android Credential Manager 桥接，支持指纹/面部识别登录
- **无缝启动**：直接显示网站加载动画，无额外启动页
- **网络感知缓存**：在线时遵守服务端缓存头，离线时自动使用本地缓存
- **断网重试**：网络恢复后自动重新加载
- **SPA 导航支持**：返回键在 SPA 内部路由间正常工作，根页面双击退出
- **禁用缩放**：锁定页面缩放，保持原生 App 体验
- **UA 清理**：去除 WebView 的 `wv` 标记，避免网站误判为不支持 Passkey 的浏览器

## 系统要求

- **运行**：Android 5.0+（API 21+），Passkey 需要 Android 9+（API 28+）
- **构建**：JDK 18、Android SDK build-tools 34.0.0、Python 3

## 目录结构

```
GymLitakuApp/
├── app/src/main/
│   ├── java/cn/litaku/gym/
│   │   ├── MainActivity.java      # 主 Activity，WebView 配置与 Passkey polyfill 注入
│   │   ├── PasskeyBridge.java     # JS ↔ Android Credential Manager 桥接
│   │   └── SplashActivity.java    # 保留备用（当前未启用）
│   ├── res/                       # 图标、布局、颜色资源
│   ├── assets/
│   │   ├── passkey_polyfill.js    # 早期注入，确保 PublicKeyCredential 在 React 水化前存在
│   │   ├── passkey_bridge.js      # 拦截 navigator.credentials，转发到 PasskeyBridge
│   │   └── offline.html           # 无网络时的离线提示页
│   └── AndroidManifest.xml
├── libs/                          # 手动构建所需的 AAR/JAR 依赖
│   ├── jars/credentials/          # androidx.credentials
│   ├── jars/credentials-play-services-auth/
│   └── jars/play-services-fido/
├── build_v17.sh                   # 手动构建脚本（aapt2 + javac + d8 + zipalign + apksigner）
├── releases/
│   └── OpenGym_v1.7.apk           # 最新签名版本
└── .gitignore
```

## 构建方法

### 环境准备

1. [Android SDK](https://developer.android.com/studio) — build-tools 34.0.0，platforms android-34
2. [JDK 18](https://aws.amazon.com/corretto/) — 路径需与 `build_v17.sh` 中一致
3. Python 3

### 签名密钥

构建前需要 `key.properties` 和对应的 keystore 文件（**不提交到版本库**）：

```properties
storeFile=<keystore 绝对路径>
storePassword=<密码>
keyAlias=<别名>
keyPassword=<密码>
```

生成新密钥：

```bash
keytool -genkeypair -v \
  -keystore opengym_release.keystore \
  -alias opengym \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

### 执行构建

```bash
# 编辑 build_v17.sh 中的路径变量（JDK、SDK、KEYSTORE 等）
bash build_v17.sh
# 输出：releases/OpenGym_v1.7.apk
```

## 对上游 OpenGym 服务端的修改

> 上游项目：[duartesantos8/opengym](https://github.com/duartesantos8/opengym)

Android Credential Manager 发起 WebAuthn 请求时，origin 格式为 `android:apk-key-hash:<base64>`，而上游 OpenGym 只接受单个 `https://` origin，导致 passkey 验证失败。需对服务端做以下修改。

### `api/server.js`

**改动 1**：在 `ORIGIN` 常量声明后（约第 42 行）插入两行：

```diff
  const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
+ const ANDROID_ORIGIN = process.env.ANDROID_ORIGIN || null;
+ const ALLOWED_ORIGINS = ANDROID_ORIGIN ? [ORIGIN, ANDROID_ORIGIN] : ORIGIN;
  const RP_NAME = process.env.RP_NAME || 'openGym';
```

**改动 2**：将以下 4 处 `expectedOrigin: ORIGIN` 全部替换为 `expectedOrigin: ALLOWED_ORIGINS`（行号以原始文件为准，搜索替换即可）：

```diff
- expectedOrigin: ORIGIN,   // 约第 1129 行（passkey 注册）
+ expectedOrigin: ALLOWED_ORIGINS,

- expectedOrigin: ORIGIN,   // 约第 1560 行（passkey 登录）
+ expectedOrigin: ALLOWED_ORIGINS,

- expectedOrigin: ORIGIN,   // 约第 1997 行
+ expectedOrigin: ALLOWED_ORIGINS,

- expectedOrigin: ORIGIN,   // 约第 2069 行
+ expectedOrigin: ALLOWED_ORIGINS,
```

### `.env`

新增一个环境变量：

```diff
  RP_ID=gym.litaku.cn
  ORIGIN=https://gym.litaku.cn
+ ANDROID_ORIGIN=android:apk-key-hash:<APK 证书 SHA-256 base64>
```

`ANDROID_ORIGIN` 的值由 APK 签名证书决定，获取方法：

```bash
apksigner verify --print-certs releases/OpenGym_v1.7.apk
# 输出中取 "SHA-256 digest" 那行的十六进制值，转为标准 base64（无填充）
# 示例：24b046a3... → JLBGo5uwje30ph6KMWCAV6rOE3/toYys6P71E0O4uHE
# 即 android:apk-key-hash:JLBGo5uwje30ph6KMWCAV6rOE3/toYys6P71E0O4uHE
```

修改完成后重建容器：

```bash
cd /opt/opengym
docker compose up -d --build api
```

### 兼容性说明

- `ALLOWED_ORIGINS` 未设置 `ANDROID_ORIGIN` 时退化为原始字符串，**不影响网页端登录**
- 使用不同签名密钥构建时必须重新计算 `ANDROID_ORIGIN`，原有 passkey 凭据仍然有效（RP_ID 未变）

## 工作原理

```
网页 navigator.credentials.create/get()
        ↓ passkey_bridge.js 拦截
PasskeyBridge.java（JavascriptInterface）
        ↓
Android Credential Manager API
        ↓ origin: android:apk-key-hash:xxx
OpenGym API（ALLOWED_ORIGINS 同时接受网页和 Android origin）
```

## 许可

本项目仅供 [gym.litaku.cn](https://gym.litaku.cn) 自用，基于 [OpenGym](https://github.com/duartesantos8/opengym) 开源项目构建。
