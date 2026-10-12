# PaddleOCR reader for the optional `paddle` image target (OCR_ENGINE=paddle).
#
# Usage: python3 -I paddle_ocr.py <list-file> <name|timer>
# Reads one image path per line from the list file and prints one JSON line per image, in order:
#   {"text": "...", "conf": 0-100}
# Recognition only (det=False): the crops already are the text line, so detection would only add
# time and occasionally split a word. The timer keeps only digits and colons, like Tesseract's
# whitelist does.
import json
import os
import platform
import re
import sys

from paddleocr import PaddleOCR  # noqa: E402  (installed only in the paddle image)


def main():
    list_file, kind = sys.argv[1], sys.argv[2]
    with open(list_file, encoding="utf-8") as fh:
        files = [line.strip() for line in fh if line.strip()]
    # All the cores the container has unless PADDLE_THREADS says otherwise (Paddle defaults to a
    # handful), and MKL-DNN where it exists: on x86 it is several times faster, on ARM it is absent.
    threads = int(os.environ.get("PADDLE_THREADS") or os.cpu_count() or 1)
    x86 = platform.machine().lower() in ("x86_64", "amd64")
    ocr = PaddleOCR(use_angle_cls=False, lang="en", show_log=False,
                    cpu_threads=threads, enable_mkldnn=x86)
    for f in files:
        text, conf = "", 0.0
        try:
            res = ocr.ocr(f, det=False, cls=False)
            if res and res[0]:
                text, conf = res[0][0][0], float(res[0][0][1])
        except Exception:  # one unreadable crop must not lose the batch
            pass
        if kind == "timer":
            text = re.sub(r"[^0-9:]", "", text)
        print(json.dumps({"text": text, "conf": round(conf * 100)}), flush=True)


if __name__ == "__main__":
    main()
