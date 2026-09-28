#!/bin/sh
set -e

# Assets URL with exercise images and gifs. You can override it with your own dataset if you want. Shall be a zip file.
ASSETS_URL="${ASSETS_URL:-https://github.com/hasaneyldrm/exercises-dataset/archive/refs/heads/main.zip}"
# Assets folder name inside the zip file. You can override it with your own dataset if you want.
ASSETS_FOLDER="${ASSETS_FOLDER:-exercises-dataset-main}"
# Flag to force update the exercise media. If set to true, it will download the assets again even if they are already present.
NEEDS_UPDATE="${NEEDS_UPDATE:-false}"
# Skip assets download regardless of status.
SKIP_ASSETS_DOWNLOAD="${SKIP_ASSETS_DOWNLOAD:-false}"
# Working directory where the assets will be extracted. You can override it with your own path if you want. It shall be matched with nginx configuration.
WORKING_DIR="${WORKING_DIR:-/usr/share/nginx/html}"
# How old shall be files so we start to perform update - in days.
UPDATE_PERIOD="${UPDATE_PERIOD:-30}"

# Skip download if SKIP_ASSETS_DOWNLOAD is 
if [  "$SKIP_ASSETS_DOWNLOAD" = "true" ]; then
    echo "✗ Skipping Assets download"
    exit 0
fi

IMG_DIR="$WORKING_DIR/img"
GIF_DIR="$WORKING_DIR/gif"
LAST_UPDATE="$IMG_DIR/LAST_UPDATE"

# Check if file exist - download happens at least once.
if [ ! -f "$LAST_UPDATE" ]; then
    NEEDS_UPDATE=true
fi

# Check if download was X days ago and force update this time
if [ "$(find $IMG_DIR/ -name "LAST_UPDATE" -type f -mtime +"$UPDATE_PERIOD" -print -quit)" ]; then
    NEEDS_UPDATE=true
fi

# Perform assets update
if [ "$NEEDS_UPDATE" = "true" ]; then
    # Ensure destination directories exist.
    mkdir -p "$IMG_DIR" "$GIF_DIR"

    # Check whether the image directory is actually writable.
    # This catches read-only mounts as well as normal permission problems.
    WRITE_TEST=$(mktemp "$IMG_DIR/.write-test.XXXXXX") || {
        echo "ERROR - can't write to the $IMG_DIR folder, check if your mount is write protected and permissions"
        exit 0
    }
    rm -f "$WRITE_TEST"

    # Create temp dir
    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

    echo -e "↓ Downloading exercise media (~140 MB, one time)…
  Source: ${ASSETS_URL}
  Metadata and instruction text: MIT.
  Images and animations: © Gym visual — https://gymvisual.com/
  They are used under that dataset's terms, not openGym's AGPL, and are
  downloaded from upstream — openGym does not redistribute them.
  Terms: https://gymvisual.com/content/3-terms-and-conditions-of-use
  Reusing this media yourself, commercially or not, needs your own license
  from Gym visual. Details in NOTICE.md."

    echo "..downloading Assets"
    wget "$ASSETS_URL" -O "$TMP_DIR/main.zip" || { echo "✗ Failed to download exercise media." >&2 ; exit 1; }
    echo "..extracting Assets"
    unzip "$TMP_DIR/main.zip" -d "$TMP_DIR" -q || { echo "✗ Failed to extract exercise media." >&2 ; exit 1; }
    echo "..coping Assets in place"
    # CP -f Override, -u Copy only newer files
    cp -fu "$TMP_DIR/${ASSETS_FOLDER}"/images/*.jpg "$IMG_DIR/" && echo "✓ Exercise images ready ($(find "$IMG_DIR" -type f -name '*.jpg' | wc -l) images)."
    cp -fu "$TMP_DIR/${ASSETS_FOLDER}"/videos/*.gif "$GIF_DIR/" && echo "✓ Exercise gif's ready ($(find "$GIF_DIR" -type f -name '*.gif' | wc -l) images)."

    # Set last update date, will use for automatically update
    date > "$LAST_UPDATE"

    rm -r "$TMP_DIR/${ASSETS_FOLDER}" $TMP_DIR/main.zip && echo "✓ Cleanup complete."
else
    echo "✓ Exercise media already present — skipping download. Last update $(cat $LAST_UPDATE)."
fi

exit 0