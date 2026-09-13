#!/usr/bin/env bash
# Builds the website's img/ folder from ../assets: the five screenshots as PNG (fallback)
# plus WebP at 480, 600 and 1170 px wide (what <picture> actually serves), and the 1200×630
# social card. Needs ffmpeg with libwebp. Usage: website/build-images.sh <dist>/img
set -euo pipefail
out=${1:?target img dir}; mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
for n in home workout stats plan library; do
  src="$here/../assets/screenshots/$n.png"
  cp "$src" "$out/$n.png"
  for w in 480 600 1170; do
    ffmpeg -v error -y -i "$src" -vf "scale=$w:-1:flags=lanczos" -c:v libwebp -quality 82 -compression_level 6 "$out/$n-$w.webp"
  done
done
cp "$here/../assets/social.jpg" "$out/social.jpg"
cp "$here/../assets/banner.png" "$out/banner.png"
echo "images written to $out"
