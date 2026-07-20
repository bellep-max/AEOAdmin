"""Step 2: download each row's S3 screenshot and OCR it with macOS Vision.

Reads rows.json (from pull-rows.mjs), writes ocr.json = {id: text}. Resumable:
re-run to fill only the rows still missing. macOS Vision (the compiled ./ocr
binary from ocr.swift) reads the map-widget / collapsed-card / wrapped-name
captures that tesseract fails on — 1195/1195 non-empty in the 2026-07 batch.

    swiftc -O ocr.swift -o ocr        # one-time build
    AWS_PROFILE=aeo-admin python3 ocr.py --rows=rows.json --out=ocr.json [--shots=/tmp/shots]
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
import boto3, botocore

HERE = os.path.dirname(os.path.abspath(__file__))
OCR_BIN = os.path.join(HERE, "ocr")


def arg(name, default=None):
    hit = next((a for a in sys.argv if a.startswith(f"--{name}=")), None)
    return hit.split("=", 1)[1] if hit else default


ROWS = arg("rows", "rows.json")
OUT = arg("out", "ocr.json")
SHOTS = arg("shots", "/tmp/adj_shots")
WORKERS = int(arg("workers", "12"))

if not os.path.exists(OCR_BIN):
    sys.exit(f"missing {OCR_BIN} — build it first: swiftc -O {HERE}/ocr.swift -o {OCR_BIN}")
os.makedirs(SHOTS, exist_ok=True)
rows = json.load(open(ROWS))
cache = json.load(open(OUT)) if os.path.exists(OUT) else {}
s3 = boto3.session.Session(profile_name=os.environ.get("AWS_PROFILE") or None).client(
    "s3", region_name="us-east-1",
    config=botocore.config.Config(max_pool_connections=32, retries={"max_attempts": 3}))


def work(r):
    rid = str(r["id"])
    if cache.get(rid):
        return rid, cache[rid]
    png = f"{SHOTS}/{rid}.png"
    if not os.path.exists(png) or os.path.getsize(png) == 0:
        url = r.get("su") or ""
        if not url.startswith("s3://"):
            return rid, ""
        bucket, _, key = url[5:].partition("/")
        try:
            s3.download_file(bucket, key, png)
        except Exception:
            return rid, ""
    try:
        return rid, subprocess.run([OCR_BIN, png], capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return rid, ""


todo = [r for r in rows if not cache.get(str(r["id"]))]
print(f"{len(rows)} rows, {len(todo)} need OCR", flush=True)
done = 0
with ThreadPoolExecutor(max_workers=WORKERS) as ex:
    for rid, txt in ex.map(work, todo):
        cache[rid] = txt
        done += 1
        if done % 150 == 0:
            json.dump(cache, open(OUT, "w"))
            print(f"  {done}/{len(todo)}", flush=True)
json.dump(cache, open(OUT, "w"))
ok = sum(1 for v in cache.values() if v.strip())
print(f"DONE: {len(cache)} cached ({ok} non-empty)")
