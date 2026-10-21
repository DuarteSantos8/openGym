#!/bin/bash
# generate_keystore.sh — 生成 APK 签名密钥库

KEYSTORE_FILE="gym_litaku_release.keystore"
ALIAS="gym_litaku"

echo "=== 生成 APK 签名密钥 ==="
echo ""

# 检查 keytool 是否可用
if ! command -v keytool &> /dev/null; then
    echo "错误: 未找到 keytool，请先安装 JDK 17+"
    exit 1
fi

# 如果密钥库已存在，询问是否覆盖
if [ -f "$KEYSTORE_FILE" ]; then
    echo "警告: $KEYSTORE_FILE 已存在"
    read -p "是否覆盖? (y/N): " confirm
    [ "$confirm" != "y" ] && exit 0
fi

echo "请填写证书信息 (直接回车使用默认值):"
read -p "  名字/姓氏 [GymLitaku]: " cn;        cn=${cn:-GymLitaku}
read -p "  组织单位 [Dev]: " ou;                ou=${ou:-Dev}
read -p "  组织名称 [LitakuGym]: " o;           o=${o:-LitakuGym}
read -p "  城市/地区 [Beijing]: " l;            l=${l:-Beijing}
read -p "  省/州 [Beijing]: " st;               st=${st:-Beijing}
read -p "  国家代码 (两位字母) [CN]: " c;       c=${c:-CN}
read -p "  密钥库密码 (>=6位): " -s ks_pass; echo ""
read -p "  再次确认密码: " -s ks_pass2; echo ""

if [ "$ks_pass" != "$ks_pass2" ]; then
    echo "错误: 两次密码不一致"
    exit 1
fi
if [ ${#ks_pass} -lt 6 ]; then
    echo "错误: 密码至少6位"
    exit 1
fi

keytool -genkeypair \
    -v \
    -keystore "$KEYSTORE_FILE" \
    -alias "$ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass "$ks_pass" \
    -keypass "$ks_pass" \
    -dname "CN=$cn, OU=$ou, O=$o, L=$l, ST=$st, C=$c"

if [ $? -eq 0 ]; then
    echo ""
    echo "=== 密钥生成成功 ==="
    echo "文件: $KEYSTORE_FILE"
    echo "别名: $ALIAS"
    echo ""
    echo "请将以下内容写入 key.properties (不要提交到 Git!):"
    echo "---"
    echo "storeFile=$(pwd)/$KEYSTORE_FILE"
    echo "storePassword=$ks_pass"
    echo "keyAlias=$ALIAS"
    echo "keyPassword=$ks_pass"
    echo "---"

    # 自动写入 key.properties
    cat > key.properties << EOF
storeFile=$(pwd)/$KEYSTORE_FILE
storePassword=$ks_pass
keyAlias=$ALIAS
keyPassword=$ks_pass
EOF
    echo "已自动写入 key.properties"
else
    echo "密钥生成失败"
    exit 1
fi
