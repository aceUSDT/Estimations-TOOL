#!/usr/bin/env python3
"""Workstream 0 coverage harness — step 1: page extraction.

For every PDF under examples/, extract the native text layer per page (the same
thing pdf.js getTextContent gives the deployed app) and, for pages with no
usable text layer, render a PNG for the OCR pass (mirrors the app's "OCR page"
action, which rasterises the page and runs tesseract.js).

Output: tools/coverage/work/<doc-slug>/meta.json (+ page-NNN.png for image-only pages)
"""
import fitz  # PyMuPDF
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = os.path.join(ROOT, 'examples')
WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work')

# The app treats a page as having a text layer when >2 reconstructed lines exist
# (index.html ingestFile: `if (lines.length>2) anyText=true`).
MIN_LINES_FOR_NATIVE = 3
RENDER_ZOOM = 3.0          # ~216 dpi on these 72dpi-boxed re-renders
MAX_LONG_EDGE = 4200       # cap so A0 sheets stay OCR-able


def slugify(rel):
    return re.sub(r'[^A-Za-z0-9._-]+', '_', rel.replace('.pdf', ''))


def native_lines(page):
    """Approximate the app's linesFromTextContent: text spans grouped into lines."""
    out = []
    d = page.get_text('dict')
    for block in d.get('blocks', []):
        for line in block.get('lines', []):
            text = ' '.join(s['text'] for s in line.get('spans', []) if s['text'].strip())
            if not text.strip():
                continue
            x0, y0, x1, y1 = line['bbox']
            out.append({'text': text, 'bbox': [x0, y0, x1 - x0, y1 - y0]})
    out.sort(key=lambda l: (round(l['bbox'][1]), l['bbox'][0]))
    return out


def main():
    os.makedirs(WORK, exist_ok=True)
    docs = []
    for dirpath, _dirnames, filenames in os.walk(EXAMPLES):
        for fn in sorted(filenames):
            if fn.lower().endswith('.pdf'):
                docs.append(os.path.join(dirpath, fn))
    docs.sort()
    index = []
    for path in docs:
        rel = os.path.relpath(path, EXAMPLES)
        slug = slugify(rel)
        outdir = os.path.join(WORK, slug)
        os.makedirs(outdir, exist_ok=True)
        doc = fitz.open(path)
        pages = []
        for i, page in enumerate(doc):
            lines = native_lines(page)
            has_text = len(lines) >= MIN_LINES_FOR_NATIVE
            rec = {
                'page': i + 1,
                'width': page.rect.width,
                'height': page.rect.height,
                'native': has_text,
                'lines': lines if has_text else [],
                'png': None,
            }
            if not has_text:
                png = os.path.join(outdir, f'page-{i + 1:03d}.png')
                if not os.path.exists(png):
                    zoom = min(RENDER_ZOOM, MAX_LONG_EDGE / max(page.rect.width, page.rect.height))
                    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
                    pix.save(png)
                rec['png'] = os.path.basename(png)
                rec['render_zoom'] = min(RENDER_ZOOM, MAX_LONG_EDGE / max(page.rect.width, page.rect.height))
            pages.append(rec)
        meta = {'file': rel, 'slug': slug, 'pages': pages}
        with open(os.path.join(outdir, 'meta.json'), 'w') as f:
            json.dump(meta, f)
        index.append({'file': rel, 'slug': slug, 'pages': len(pages),
                      'native_pages': sum(1 for p in pages if p['native'])})
        print(f"{rel}: {len(pages)} pages, {sum(1 for p in pages if p['native'])} native-text", file=sys.stderr)
    with open(os.path.join(WORK, 'index.json'), 'w') as f:
        json.dump(index, f, indent=2)


if __name__ == '__main__':
    main()
