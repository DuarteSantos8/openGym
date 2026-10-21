#!/bin/bash
# build_release.sh — 编译并签名 Release APK

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$PROJECT_DIR/release_output"

echo "=== GymLitaku APK 构建脚本 ==="
echo ""

# 检查 key.properties
if [ ! -f "$PROJECT_DIR/key.properties" ]; then
    echo "错误: 未找到 key.properties，请先运行 generate_keystore.sh"
    exit 1
fi

# 赋予 gradlew 执行权限
chmod +x "$PROJECT_DIR/gradlew"

# 清理旧构建
echo "[1/3] 清理旧构建..."
"$PROJECT_DIR/gradlew" clean -p "$PROJECT_DIR"

# 编译 Release（Gradle 会自动签名，因为 build.gradle 已配置 signingConfigs）
echo "[2/3] 编译 Release APK..."
"$PROJECT_DIR/gradlew" assembleRelease -p "$PROJECT_DIR"

# 收集 APK
echo "[3/3] 复制 APK 到 $OUTPUT_DIR ..."
mkdir -p "$OUTPUT_DIR"
find "$PROJECT_DIR/app/build/outputs/apk/release" -name "*.apk" -exec cp {} "$OUTPUT_DIR/" \;

echo ""
echo "=== 构建完成 ==="
ls -lh "$OUTPUT_DIR/"*.apk
echo ""
echo "APK 已签名，可直接安装到 Android 设备。"
