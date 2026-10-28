#!/usr/bin/env python3
"""Layout checks for openGym's printed PDFs (scripts/pdf/render-samples.mjs).

Documents rendered with `probe: true` carry invisible marks:
  ~s:<id>~ / ~e:<id>~  first and last line of a block that must stay on one page
                       (an exercise, a superset, a chart, a summary card row, a list row)
  ~h:<id>~             a heading; the block it introduces carries ~s:<id>~ too
  ~split:<id>~         a block too tall for any page; it may break, but only between its rows
The check finds the page every mark landed on, from the PDF's own text layer, and fails when
  - a block's start and end are on different pages (it was cut across a page break),
  - a heading sits on a different page than the first block it introduces (an orphan),
  - any visible text runs past the page's printable area (overflow).
With --png it also writes page images next to each PDF (<pdf>-p<N>.png, 110 dpi).
Needs PyMuPDF: pip install pymupdf
"""
import re
import sys

import fitz  # PyMuPDF

MARK = re.compile(r"~([seh]|split):([A-Za-z0-9_.-]+)~")


def check(path, png=False, do_check=True):
    doc = fitz.open(path)
    pages = {}
    problems = []
    for pno, page in enumerate(doc):
        width = page.rect.width
        for x0, y0, x1, y1, text, *_ in page.get_text("words"):
            for kind, ident in MARK.findall(text):
                pages.setdefault((kind, ident), []).append(pno + 1)
            if MARK.search(text):
                continue
            # 6 mm from the paper edge: text there is outside any sane printable area.
            if x1 > width - 17 or x0 < 17:
                problems.append(f"p{pno + 1}: text past the edge: {text!r} x={x0:.0f}..{x1:.0f} of {width:.0f}")
        if png:
            page.get_pixmap(dpi=110).save(f"{path[:-4]}-p{pno + 1}.png")
    # Where on its page each start mark sits (0 = top of the printable area, 1 = bottom).
    tops = {}
    for pno, page in enumerate(doc):
        height = page.rect.height
        for x0, y0, x1, y1, text, *_ in page.get_text("words"):
            for kind, ident in MARK.findall(text):
                if kind == "s" and ident not in tops:
                    tops[ident] = y0 / height
    blocks = sorted({ident for kind, ident in pages if kind == "s"})
    for ident in blocks:
        start = pages.get(("s", ident), [None])[0]
        end = pages.get(("e", ident), [None])[-1]
        if end is None:
            problems.append(f"block {ident}: end mark missing")
        elif start != end:
            # A block taller than a page (T- ids: one workout in the report's list) has to run
            # over; that is fine when it starts at the top of a page, not when it was begun low
            # on a page it could have been moved past.
            if ident.startswith("T-") and tops.get(ident, 1) < 0.3:
                pass
            else:
                problems.append(f"block {ident}: split across pages {start}-{end}")
        head = pages.get(("h", ident))
        if head and head[0] != start:
            problems.append(f"heading {ident}: on page {head[0]}, its first block on page {start} (orphan)")
    n = len(doc)
    status = "OK" if not problems else "FAIL"
    if do_check:
        print(f"{status} {path}: {n} page(s), {len(blocks)} block(s) checked")
        for p in problems:
            print("   ", p)
    else:
        print(f"{path}: {n} page(s)")
    return not problems or not do_check


def main(argv):
    png = "--png" in argv
    do_check = "--no-check" not in argv
    files = [a for a in argv if not a.startswith("--")]
    ok = all([check(f, png, do_check) for f in files])
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
