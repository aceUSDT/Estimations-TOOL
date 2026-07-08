#!/usr/bin/env python3
"""Render downscaled JPEGs (<=1300px long edge) for the AI extraction pass.

The full-res work/ PNGs (~2079x2961) push a single Sonnet-5 extraction near
Netlify's 30s sync limit. A ~1300px JPEG is still legible for schedule tables
but cuts vision-input tokens and latency. Writes work/<slug>/ai-<page>.jpg.

Usage: python3 render_ai_images.py [--all]   (default: ground-truth docs only)
"""
import fitz  # PyMuPDF
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
EXAMPLES = os.path.join(ROOT, 'examples')
WORK = os.path.join(HERE, 'work')
LONG_EDGE = 1300

index = json.load(open(os.path.join(WORK, 'index.json')))
gt = json.load(open(os.path.join(HERE, 'ground-truth.json')))
run_all = '--all' in sys.argv
docs = index if run_all else [d for d in index if d['file'] in gt]

total = 0
for doc in docs:
    path = os.path.join(EXAMPLES, doc['file'])
    outdir = os.path.join(WORK, doc['slug'])
    os.makedirs(outdir, exist_ok=True)
    pdf = fitz.open(path)
    for i, page in enumerate(pdf):
        out = os.path.join(outdir, f'ai-{i + 1:03d}.jpg')
        if os.path.exists(out):
            continue
        zoom = LONG_EDGE / max(page.rect.width, page.rect.height)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        pix.save(out, jpg_quality=80)
        total += 1
    print(f"{doc['file']}: {pdf.page_count} pages", file=sys.stderr)
print(f"rendered {total} downscaled JPEGs", file=sys.stderr)
