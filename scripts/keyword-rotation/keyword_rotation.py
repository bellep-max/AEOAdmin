"""
AEO Keyword Rotation Script
Implements the 5-of-7 days rule to rotate keywords for DeepSeek content generation.
Logs all runs and scores to Langfuse for observability.
"""

import json
import os
import sys
import logging
from datetime import date, timedelta
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────
AEO_API_BASE = os.getenv("AEO_API_BASE", "https://jjm59vpn3y.us-east-1.awsapprunner.com")
AEO_API_TOKEN = os.getenv("AEO_API_TOKEN", "")
CLIENT_ID = int(os.getenv("CLIENT_ID", "5"))
PLATFORM = os.getenv("PLATFORM", "chatgpt")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
LANGFUSE_SECRET_KEY = os.getenv("LANGFUSE_SECRET_KEY", "")
LANGFUSE_PUBLIC_KEY = os.getenv("LANGFUSE_PUBLIC_KEY", "")
KEYWORDS_FILE = os.getenv("KEYWORDS_FILE", "keywords.json")
TOP3_THRESHOLD = 3
LOCK_MIN_DAYS = 5
WINDOW_DAYS = 7


# ── Langfuse thin client ─────────────────────────────────────────────────────
class LangfuseClient:
    BASE = "https://cloud.langfuse.com"

    def __init__(self, public_key: str, secret_key: str):
        self.auth = (public_key, secret_key)
        self._trace_id: Optional[str] = None

    def _post(self, path: str, payload: dict) -> dict:
        if not self.auth[0] or not self.auth[1]:
            log.warning("Langfuse keys not set — skipping trace logging.")
            return {}
        resp = requests.post(
            f"{self.BASE}{path}",
            json=payload,
            auth=self.auth,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def create_trace(self, name: str, metadata: dict) -> str:
        data = self._post("/api/public/traces", {"name": name, "metadata": metadata})
        self._trace_id = data.get("id", "")
        return self._trace_id

    def score(self, name: str, value: float, keyword: str):
        if not self._trace_id:
            return
        self._post(
            "/api/public/scores",
            {
                "traceId": self._trace_id,
                "name": name,
                "value": value,
                "comment": keyword,
            },
        )

    def generation(self, name: str, model: str, prompt: str, completion: str):
        if not self._trace_id:
            return
        self._post(
            "/api/public/generations",
            {
                "traceId": self._trace_id,
                "name": name,
                "model": model,
                "prompt": prompt,
                "completion": completion,
            },
        )

    def event(self, name: str, metadata: dict):
        if not self._trace_id:
            return
        self._post(
            "/api/public/events",
            {"traceId": self._trace_id, "name": name, "metadata": metadata},
        )


# ── Ranking API ──────────────────────────────────────────────────────────────
def fetch_rankings(keyword_text: str, date_from: str, date_to: str) -> list[dict]:
    """Fetch ranking records for a keyword in a date range."""
    url = f"{AEO_API_BASE}/api/ranking-reports"
    headers = {"Authorization": f"Bearer {AEO_API_TOKEN}"}
    params = {
        "clientId": CLIENT_ID,
        "platform": PLATFORM,
        "status": "success",
        "dateFrom": date_from,
        "dateTo": date_to,
        "limit": 100,
        # Filter by keyword text on the server if the API supports it,
        # otherwise we filter client-side below.
    }
    resp = requests.get(url, headers=headers, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    records = data.get("data", data) if isinstance(data, dict) else data
    # Filter to this keyword — API returns "keyword" field (not "keywordText")
    return [
        r for r in records
        if r.get("keyword", "").strip().lower() == keyword_text.strip().lower()
    ]


# ── DeepSeek generation ──────────────────────────────────────────────────────
SYSTEM_PROMPT = (
    "You are an AEO (Answer Engine Optimization) content strategist. "
    "Write concise, factual content optimized to be cited by AI answer engines "
    "like ChatGPT, Gemini, and Perplexity. Use FAQ format with clear question-and-answer pairs."
)

USER_PROMPT_TPL = """\
Keyword: {keyword}

Ground truth answer:
{ground_truth}

Write a short AEO-optimized FAQ snippet (2–3 Q&A pairs, ≤200 words) that:
1. Directly answers the keyword query.
2. Uses the ground truth as the factual basis.
3. Is structured so an AI assistant would cite it as the authoritative answer.
"""


def generate_content(keyword: str, ground_truth: str) -> str:
    url = "https://api.deepseek.com/chat/completions"
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "deepseek-chat",
        "temperature": 0.3,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT_TPL.format(
                keyword=keyword, ground_truth=ground_truth
            )},
        ],
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=60)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


# ── Core rotation logic ──────────────────────────────────────────────────────
def run_rotation(keywords_path: str = KEYWORDS_FILE):
    today = date.today()
    yesterday = today - timedelta(days=1)
    window_start = today - timedelta(days=WINDOW_DAYS)

    date_from = window_start.isoformat()
    date_to = yesterday.isoformat()
    run_date = today.isoformat()

    log.info(f"=== Keyword Rotation Run: {run_date} ===")
    log.info(f"Window: {date_from} → {date_to} | client={CLIENT_ID} platform={PLATFORM}")

    # Load keyword config
    with open(keywords_path) as f:
        config = json.load(f)
    keywords = config.get("keywords", [])

    if not keywords:
        log.error("No keywords found in keywords.json")
        return

    # Init Langfuse
    lf = LangfuseClient(LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY)
    lf.create_trace(
        name=f"rotation_run_{run_date}",
        metadata={"clientId": CLIENT_ID, "platform": PLATFORM, "dateFrom": date_from, "dateTo": date_to},
    )

    active_keywords = []
    locked_keywords = []

    for kw in keywords:
        keyword_text = kw["keyword"]
        priority = kw.get("priority", 99)
        ground_truth = kw.get("ground_truth", "")

        try:
            records = fetch_rankings(keyword_text, date_from, date_to)
        except Exception as e:
            log.warning(f"  [{keyword_text}] Failed to fetch rankings: {e}")
            records = []

        # Count days in top 3
        top3_days = sum(
            1 for r in records
            if isinstance(r.get("rankingPosition"), (int, float)) and r["rankingPosition"] <= TOP3_THRESHOLD
        )
        stability = top3_days / WINDOW_DAYS

        # Most recent position
        sorted_records = sorted(records, key=lambda r: r.get("date", r.get("createdAt", "")), reverse=True)
        current_rank = sorted_records[0]["rankingPosition"] if sorted_records else None

        is_locked = top3_days >= LOCK_MIN_DAYS

        log.info(
            f"  [{keyword_text}] top3_days={top3_days}/7  stability={stability:.2f}"
            f"  current_rank={current_rank}  locked={is_locked}"
        )

        # Log score to Langfuse
        lf.score(name="top3_stability", value=stability, keyword=keyword_text)

        entry = {
            "keyword": keyword_text,
            "priority": priority,
            "ground_truth": ground_truth,
            "top3_days": top3_days,
            "stability": stability,
            "current_rank": current_rank,
            "locked": is_locked,
        }

        if is_locked:
            locked_keywords.append(entry)
        else:
            active_keywords.append(entry)

    log.info(f"\nLocked keywords ({len(locked_keywords)}): {[k['keyword'] for k in locked_keywords]}")
    log.info(f"Active keywords ({len(active_keywords)}): {[k['keyword'] for k in active_keywords]}")

    if not active_keywords:
        msg = "All keywords are locked (≥5 days in Top 3). No optimization needed today."
        log.info(msg)
        lf.event("rotation_decision", {"result": "all_locked", "message": msg})
        return

    # Select best active keyword: lowest current_rank first, then lowest priority number
    def sort_key(kw: dict):
        rank = kw["current_rank"] if kw["current_rank"] is not None else 9999
        return (rank, kw["priority"])

    active_keywords.sort(key=sort_key)
    selected = active_keywords[0]

    log.info(f"\nSelected keyword for optimization: '{selected['keyword']}'")
    log.info(f"  current_rank={selected['current_rank']}  priority={selected['priority']}")

    lf.event(
        "rotation_decision",
        {
            "selected": selected["keyword"],
            "current_rank": selected["current_rank"],
            "active_count": len(active_keywords),
            "locked_count": len(locked_keywords),
        },
    )

    # Generate content
    if not DEEPSEEK_API_KEY:
        log.warning("DEEPSEEK_API_KEY not set — skipping content generation.")
        return

    log.info("\nGenerating AEO content with DeepSeek...")
    prompt_used = USER_PROMPT_TPL.format(
        keyword=selected["keyword"], ground_truth=selected["ground_truth"]
    )

    try:
        content = generate_content(selected["keyword"], selected["ground_truth"])
    except Exception as e:
        log.error(f"DeepSeek generation failed: {e}")
        return

    lf.generation(
        name="deepseek_aeo_content",
        model="deepseek-chat",
        prompt=prompt_used,
        completion=content,
    )

    # Output
    output_file = f"rotation_output_{run_date}.txt"
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(f"=== AEO Rotation Output: {run_date} ===\n")
        f.write(f"Selected keyword: {selected['keyword']}\n")
        f.write(f"Current rank: {selected['current_rank']} | Top-3 days: {selected['top3_days']}/7\n\n")
        f.write("--- Generated Content ---\n")
        f.write(content)

    log.info(f"\nContent saved to {output_file}")
    log.info("\n--- Generated Content Preview ---")
    log.info(content)
    log.info("=== Run complete ===")


if __name__ == "__main__":
    kw_file = sys.argv[1] if len(sys.argv) > 1 else KEYWORDS_FILE
    run_rotation(kw_file)
