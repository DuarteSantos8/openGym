#!/bin/sh
set -e

# Assets URL with exercise images and gifs. You can override it with your own dataset if you want. Shall be a zip file.
ASSETS_URL="${ASSETS_URL:-https://github.com/hasaneyldrm/exercises-dataset/archive/refs/heads/main.zip}"
# Assets folder name inside the zip file. You can override it with your own dataset if you want.
ASSETS_FOLDER="${ASSETS_FOLDER:-exercises-dataset-main}"
# Flag to force update the exercise media. If set to true, it will download the assets again even if they are already present.
NEEDS_UPDATE="${NEEDS_UPDATE:-false}"
# Working directory where the assets will be extracted. You can override it with your own path if you want.
WORKING_DIR="${WORKING_DIR:-/usr/share/nginx/html}"

# Skip download if SKIP_ASSETS_DOWNLOAD is 
if [  "$SKIP_ASSETS_DOWNLOAD" = "true" ]; then
    exit 0
fi

# Check if file exist - download happens at least once.
if [ ! -f "$WORKING_DIR/img/LAST_UPDATE" ]; then
    NEEDS_UPDATE=true
fi

# Check if download was 30 days ago and force update
if [ "$(find $WORKING_DIR/img/ -name "LAST_UPDATE" -type f -mtime +30 -print -quit)" ]; then
    NEEDS_UPDATE=true
fi

if [ "$NEEDS_UPDATE" = "true" ]; then
    echo -e "↓ Downloading exercise media (~140 MB, one time)…
  Source: ${ASSETS_URL}
  Metadata and instruction text: MIT.
  Images and animations: © Gym visual — https://gymvisual.com/
  They are used under that dataset's terms, not openGym's AGPL, and are
  downloaded from upstream — openGym does not redistribute them.
  Terms: https://gymvisual.com/content/3-terms-and-conditions-of-use
  Reusing this media yourself, commercially or not, needs your own license
  from Gym visual. Details in NOTICE.md."

    wget "$ASSETS_URL" -O /tmp/main.zip || { echo "✗ Failed to download exercise media." >&2 ; exit 1; }
    unzip /tmp/main.zip -d /tmp -q || { echo "✗ Failed to extract exercise media." >&2 ; exit 1; }
    # CP -f Override, -u Copy only newer files
    cp -fu /tmp/${ASSETS_FOLDER}/images/*.jpg $WORKING_DIR/img/ && echo "✓ Exercise images ready ($(ls $WORKING_DIR/img/ | wc -l) images)."
    cp -fu /tmp/${ASSETS_FOLDER}/videos/*.gif $WORKING_DIR/gif/ && echo "✓ Exercise gif's ready ($(ls $WORKING_DIR/gif | wc -l) images)."

    # Set last update date, will use for automatically update
    date > $WORKING_DIR/img/LAST_UPDATE

    rm -r /tmp/${ASSETS_FOLDER} /tmp/main.zip && echo "Cleanup complete."
else
    echo "✓ Exercise media already present — skipping download. Last update $(cat $WORKING_DIR/img/LAST_UPDATE)."
fi

exit 0