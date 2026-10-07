#!/bin/sh
# Renders every *.mmd here to a light and a dark PNG. GitHub's mobile app shows ```mermaid
# blocks as plain code, so the README embeds these images instead; edit the .mmd, then run this.
#   sh docs/diagrams/render.sh      (needs Node; mermaid-cli downloads its own Chrome)
set -e
cd "$(dirname "$0")"
for f in *.mmd; do
  n=${f%.mmd}
  npx -y -p @mermaid-js/mermaid-cli@11 mmdc ${PUPPETEER_CONFIG:+-p "$PUPPETEER_CONFIG"} -i "$f" -o "$n.png" -t default -b white -s 2
  npx -y -p @mermaid-js/mermaid-cli@11 mmdc ${PUPPETEER_CONFIG:+-p "$PUPPETEER_CONFIG"} -i "$f" -o "$n-dark.png" -t dark -b '#0d1117' -s 2
done
