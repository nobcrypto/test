# analyzer.py — keyword scoring & market impact analysis

from __future__ import annotations
from typing import Any

# ---------------------------------------------------------------------------
# Keyword → market signal mapping
# ---------------------------------------------------------------------------

SIGNAL_RULES: list[dict] = [
    # --- Escalation (bearish equities, bullish oil/gold) ---
    {"keywords": ["attack", "airstrike", "strike", "military action", "war", "conflict", "explosion"],
     "oil": +3, "gold": +2, "usd": +1, "risk_delta": +3, "label": "Military Escalation"},

    {"keywords": ["hormuz", "strait of hormuz", "blockade", "close strait"],
     "oil": +5, "gold": +2, "usd": +1, "risk_delta": +5, "label": "Hormuz Closure Risk"},

    {"keywords": ["ballistic missile", "drone attack", "irgc operation"],
     "oil": +2, "gold": +2, "usd": +1, "risk_delta": +2, "label": "IRGC/Missile Activity"},

    {"keywords": ["sanction", "sanctions", "embargo", "export ban"],
     "oil": +2, "gold": +1, "usd": +1, "risk_delta": +2, "label": "Sanctions Pressure"},

    {"keywords": ["nuclear", "enrichment", "uranium", "iaea", "natanz", "fordow", "breakout"],
     "oil": +1, "gold": +1, "usd": 0, "risk_delta": +2, "label": "Nuclear Program"},

    {"keywords": ["houthi", "red sea", "shipping", "tanker"],
     "oil": +2, "gold": +1, "usd": 0, "risk_delta": +2, "label": "Red Sea/Houthi Threat"},

    # --- De-escalation (bullish equities, bearish oil/gold) ---
    {"keywords": ["deal", "agreement", "jcpoa", "nuclear deal", "diplomacy", "talks", "ceasefire"],
     "oil": -3, "gold": -1, "usd": -1, "risk_delta": -3, "label": "Diplomatic Progress"},

    {"keywords": ["sanctions relief", "waiver", "lifting sanctions", "export increase"],
     "oil": -4, "gold": -1, "usd": -1, "risk_delta": -3, "label": "Sanctions Relief"},

    {"keywords": ["opec", "output cut", "production cut", "supply cut"],
     "oil": +2, "gold": 0, "usd": 0, "risk_delta": +1, "label": "OPEC Supply Action"},
]

RISK_LABELS = {
    range(-10, -3): ("LOW",      "#22c55e"),   # green
    range(-3,   1): ("MODERATE", "#eab308"),   # yellow
    range(1,    4): ("ELEVATED", "#f97316"),   # orange
    range(4,   20): ("CRITICAL", "#ef4444"),   # red
}


# ---------------------------------------------------------------------------
# Per-article scoring
# ---------------------------------------------------------------------------

def score_article(article: dict) -> dict:
    text = (article["title"] + " " + article["summary"]).lower()
    total = {"oil": 0, "gold": 0, "usd": 0, "risk_delta": 0}
    matched_labels: list[str] = []

    for rule in SIGNAL_RULES:
        if any(kw in text for kw in rule["keywords"]):
            total["oil"]        += rule["oil"]
            total["gold"]       += rule["gold"]
            total["usd"]        += rule["usd"]
            total["risk_delta"] += rule["risk_delta"]
            matched_labels.append(rule["label"])

    article["signals"]      = matched_labels
    article["score_oil"]    = total["oil"]
    article["score_gold"]   = total["gold"]
    article["score_usd"]    = total["usd"]
    article["risk_delta"]   = total["risk_delta"]
    return article


# ---------------------------------------------------------------------------
# Aggregate summary across all articles
# ---------------------------------------------------------------------------

def aggregate(articles: list[dict]) -> dict:
    if not articles:
        return _empty_summary()

    oil_total  = sum(a["score_oil"]  for a in articles)
    gold_total = sum(a["score_gold"] for a in articles)
    usd_total  = sum(a["score_usd"]  for a in articles)
    risk_total = sum(a["risk_delta"] for a in articles)

    # Normalise to [-5, +5]
    n = len(articles)
    oil_norm  = max(-5, min(5, round(oil_total  / n, 1)))
    gold_norm = max(-5, min(5, round(gold_total / n, 1)))
    usd_norm  = max(-5, min(5, round(usd_total  / n, 1)))
    risk_norm = max(-5, min(5, round(risk_total / n, 1)))

    risk_level, risk_color = _risk_label(risk_norm)

    # Top signals by frequency
    all_signals: list[str] = []
    for a in articles:
        all_signals.extend(a.get("signals", []))
    signal_counts: dict[str, int] = {}
    for s in all_signals:
        signal_counts[s] = signal_counts.get(s, 0) + 1
    top_signals = sorted(signal_counts.items(), key=lambda x: x[1], reverse=True)[:6]

    return {
        "article_count": n,
        "oil_score":     oil_norm,
        "gold_score":    gold_norm,
        "usd_score":     usd_norm,
        "risk_score":    risk_norm,
        "risk_level":    risk_level,
        "risk_color":    risk_color,
        "top_signals":   [{"label": s, "count": c} for s, c in top_signals],
        "source_counts": _count_sources(articles),
    }


def _risk_label(score: float) -> tuple[str, str]:
    for r, (label, color) in RISK_LABELS.items():
        if score in r:
            return label, color
    return ("CRITICAL", "#ef4444")


def _count_sources(articles: list[dict]) -> list[dict]:
    counts: dict[str, int] = {}
    for a in articles:
        counts[a["source"]] = counts.get(a["source"], 0) + 1
    return [{"source": s, "count": c}
            for s, c in sorted(counts.items(), key=lambda x: x[1], reverse=True)]


def _empty_summary() -> dict:
    return {
        "article_count": 0,
        "oil_score": 0, "gold_score": 0, "usd_score": 0, "risk_score": 0,
        "risk_level": "LOW", "risk_color": "#22c55e",
        "top_signals": [], "source_counts": [],
    }
