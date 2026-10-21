#!/bin/bash
# build_v17.sh — 手动构建 OpenGym v1.7 APK（PasskeyBridge + 所有 v1.6 优化）
set -e

PROJECT="/c/Users/I578337/Documents/Scripts/GymLitakuApp"
SDK="/c/Users/I578337/Documents/Scripts/android-sdk-setup/sdk"
BUILD_TOOLS="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
JDK="/c/Users/I578337/.jdks/corretto-18.0.2"
KEYSTORE="$PROJECT/gym_litaku_release.keystore"
KEY_ALIAS="gym_litaku"
KEY_PASS="litaku2024"

MANUAL="$PROJECT/build_manual"
SRC="$PROJECT/app/src/main"
LIBS="$PROJECT/libs"

echo "=== OpenGym v1.7 Build ==="

# ── 1. 清理 ──────────────────────────────────────────────────────────────────
echo "[1/7] 清理旧构建..."
rm -rf "$MANUAL/res_compiled" "$MANUAL/gen" "$MANUAL/classes" "$MANUAL/dex"
rm -f  "$MANUAL/base.apk" "$MANUAL/unsigned.apk" "$MANUAL/aligned.apk"
mkdir -p "$MANUAL/res_compiled" "$MANUAL/gen/cn/litaku/gym" "$MANUAL/classes" "$MANUAL/dex"

# ── 2. 编译资源 ───────────────────────────────────────────────────────────────
echo "[2/7] 编译资源 (aapt2 compile)..."
"$BUILD_TOOLS/aapt2" compile \
  --dir "$SRC/res" \
  -o "$MANUAL/res_compiled"

# ── 3. 链接资源 ───────────────────────────────────────────────────────────────
echo "[3/7] 链接资源 (aapt2 link)..."
"$BUILD_TOOLS/aapt2" link \
  -o "$MANUAL/base.apk" \
  -I "$PLATFORM" \
  --manifest "$SRC/AndroidManifest.xml" \
  --java "$MANUAL/gen" \
  --min-sdk-version 21 \
  --target-sdk-version 34 \
  --version-code 17 \
  --version-name "1.7" \
  --auto-add-overlay \
  "$MANUAL/res_compiled"/*.flat

# ── 4. 编译 Java ──────────────────────────────────────────────────────────────
echo "[4/7] 编译 Java (javac)..."

# 构建 Windows 格式 classpath（cygpath 转换分号分隔）
UNIX_CP="$PLATFORM:$LIBS/annotation.jar:$LIBS/jars/credentials/classes.jar:$LIBS/jars/credentials-play-services-auth/classes.jar:$LIBS/jars/play-services-fido/classes.jar"
WIN_CP=$(cygpath -wp "$UNIX_CP")

"$JDK/bin/javac.exe" \
  -source 8 -target 8 \
  -encoding UTF-8 \
  -classpath "$WIN_CP" \
  -d "$MANUAL/classes" \
  "$MANUAL/gen/cn/litaku/gym/R.java" \
  "$SRC/java/cn/litaku/gym/MainActivity.java" \
  "$SRC/java/cn/litaku/gym/PasskeyBridge.java" \
  "$SRC/java/cn/litaku/gym/SplashActivity.java"

# ── 5. DEX ────────────────────────────────────────────────────────────────────
echo "[5/7] 生成 DEX (d8)..."
export JAVA_HOME=$(cygpath -w "$JDK")
WIN_CLASSES=$(cygpath -wp "$MANUAL/classes")
WIN_CREDS=$(cygpath -wp "$LIBS/jars/credentials/classes.jar")
WIN_CREDS_PS=$(cygpath -wp "$LIBS/jars/credentials-play-services-auth/classes.jar")
WIN_FIDO=$(cygpath -wp "$LIBS/jars/play-services-fido/classes.jar")
WIN_KOTLIN=$(cygpath -wp "$LIBS/kotlin-stdlib.jar")
WIN_DEX=$(cygpath -wp "$MANUAL/dex")

"$BUILD_TOOLS/d8.bat" \
  --output "$WIN_DEX" \
  --min-api 21 \
  "$WIN_CLASSES/cn/litaku/gym/MainActivity.class" \
  "$WIN_CLASSES/cn/litaku/gym/MainActivity\$1.class" \
  "$WIN_CLASSES/cn/litaku/gym/MainActivity\$2.class" \
  "$WIN_CLASSES/cn/litaku/gym/MainActivity\$3.class" \
  "$WIN_CLASSES/cn/litaku/gym/MainActivity\$4.class" \
  "$WIN_CLASSES/cn/litaku/gym/PasskeyBridge.class" \
  "$WIN_CLASSES/cn/litaku/gym/PasskeyBridge\$1.class" \
  "$WIN_CLASSES/cn/litaku/gym/PasskeyBridge\$2.class" \
  "$WIN_CLASSES/cn/litaku/gym/SplashActivity.class" \
  "$WIN_CLASSES/cn/litaku/gym/R.class" \
  "$WIN_CLASSES/cn/litaku/gym/R\$color.class" \
  "$WIN_CLASSES/cn/litaku/gym/R\$drawable.class" \
  "$WIN_CLASSES/cn/litaku/gym/R\$id.class" \
  "$WIN_CLASSES/cn/litaku/gym/R\$layout.class" \
  "$WIN_CLASSES/cn/litaku/gym/R\$mipmap.class" \
  "$WIN_CLASSES/cn/litaku/gym/R\$string.class" \
  "$WIN_CREDS" \
  "$WIN_CREDS_PS" \
  "$WIN_FIDO" \
  "$WIN_KOTLIN"

# ── 6. 打包 APK ──────────────────────────────────────────────────────────────
echo "[6/7] 打包 APK (Python zipfile)..."
C:/Users/I578337/AppData/Local/Programs/Python/Python313/python.exe -I - << 'PYEOF'
import zipfile, os, shutil

project = r"C:\Users\I578337\Documents\Scripts\GymLitakuApp"
manual  = os.path.join(project, "build_manual")
src     = os.path.join(project, "app", "src", "main")

base_apk   = os.path.join(manual, "base.apk")
unsigned   = os.path.join(manual, "unsigned.apk")

# 从 base.apk 提取资源（aapt2 proto-format 输出）
shutil.copy(base_apk, unsigned)

with zipfile.ZipFile(unsigned, "a", compression=zipfile.ZIP_DEFLATED) as apk:
    # classes.dex
    apk.write(os.path.join(manual, "dex", "classes.dex"), "classes.dex")

    # assets
    assets_dir = os.path.join(src, "assets")
    for fname in os.listdir(assets_dir):
        apk.write(os.path.join(assets_dir, fname), f"assets/{fname}")

print("unsigned.apk assembled")
PYEOF

# ── 7. zipalign ──────────────────────────────────────────────────────────────
echo "[7a/7] zipalign..."
rm -f "$MANUAL/aligned.apk"
"$BUILD_TOOLS/zipalign" -f -v 4 "$MANUAL/unsigned.apk" "$MANUAL/aligned.apk"

# ── 8. 签名 ───────────────────────────────────────────────────────────────────
echo "[7b/7] apksigner..."
OUTPUT="$PROJECT/OpenGym_v1.7.apk"
export JAVA_HOME=$(cygpath -w "$JDK")
"$BUILD_TOOLS/apksigner.bat" sign \
  --min-sdk-version 21 \
  --ks "$(cygpath -w "$KEYSTORE")" \
  --ks-pass "pass:$KEY_PASS" \
  --ks-key-alias "$KEY_ALIAS" \
  --key-pass "pass:$KEY_PASS" \
  --out "$(cygpath -w "$OUTPUT")" \
  "$(cygpath -w "$MANUAL/aligned.apk")"

echo ""
echo "=== 构建完成 ==="
ls -lh "$OUTPUT"
echo ""
echo "SHA-256 指纹（服务器需要的 APK Key Hash）:"
"$BUILD_TOOLS/apksigner.bat" verify --print-certs "$(cygpath -w "$OUTPUT")" 2>&1 | grep -i "sha-256\|sha256" | head -3
