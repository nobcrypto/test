# feeds.py — RSS source definitions and fetcher

import feedparser
import requests
from datetime import datetime, timezone
from dateutil import parser as dateparser

# ---------------------------------------------------------------------------
# Source registry
# ---------------------------------------------------------------------------

SOURCES = [
    # Western wire services
    {"name": "Reuters World",    "url": "https://feeds.reuters.com/reuters/worldNews",          "bias": "neutral"},
    {"name": "Reuters Business", "url": "https://feeds.reuters.com/reuters/businessNews",       "bias": "neutral"},
    {"name": "AP Top News",      "url": "https://rsshub.app/apnews/topics/ap-top-news",         "bias": "neutral"},
    # Middle East focused
    {"name": "Al Jazeera",       "url": "https://www.aljazeera.com/xml/rss/all.xml",            "bias": "me_focus"},
    {"name": "Middle East Eye",  "url": "https://www.middleeasteye.net/rss",                    "bias": "me_focus"},
    {"name": "Haaretz",          "url": "https://www.haaretz.com/srv/haaretz-en-rss.xml",       "bias": "il_focus"},
    {"name": "Times of Israel",  "url": "https://www.timesofisrael.com/feed/",                  "bias": "il_focus"},
    # Energy / Market
    {"name": "OilPrice.com",     "url": "https://oilprice.com/rss/main",                        "bias": "energy"},
    {"name": "ForexLive",        "url": "https://www.forexlive.com/feed/news",                  "bias": "market"},
    # Official Iranian state media
    {"name": "PressTV",          "url": "https://www.presstv.ir/rss.xml",                       "bias": "ir_state"},
]

# ---------------------------------------------------------------------------
# Iran-related keyword filter
# ---------------------------------------------------------------------------

IRAN_KEYWORDS = [
    "iran", "iranian", "tehran", "khamenei", "rouhani", "raisi", "irgc",
    "revolutionary guard", "nuclear", "jcpoa", "enrichment", "uranium",
    "sanctions", "hormuz", "strait of hormuz", "houthi", "proxy",
    "iaea", "natanz", "fordow", "arak", "ballistic", "missile",
    "crude oil", "oil price", "opec", "persian gulf",
]


def _is_iran_related(title: str, summary: str) -> bool:
    text = (title + " " + summary).lower()
    return any(kw in text for kw in IRAN_KEYWORDS)


def _parse_date(entry) -> datetime:
    for attr in ("published", "updated"):
        raw = getattr(entry, attr, None)
        if raw:
            try:
                return dateparser.parse(raw).astimezone(timezone.utc)
            except Exception:
                pass
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Public fetch function
# ---------------------------------------------------------------------------

def fetch_all_feeds(max_per_source: int = 30) -> list[dict]:
    """Fetch and filter Iran-related articles from all sources."""
    articles = []
    headers = {"User-Agent": "IranDashboard/1.0 (trading research tool)"}

    for src in SOURCES:
        try:
            resp = requests.get(src["url"], headers=headers, timeout=10)
            feed = feedparser.parse(resp.text)
        except Exception:
            try:
                feed = feedparser.parse(src["url"])
            except Exception:
                continue

        for entry in feed.entries[:max_per_source]:
            title   = entry.get("title", "")
            summary = entry.get("summary", entry.get("description", ""))
            link    = entry.get("link", "")

            if not _is_iran_related(title, summary):
                continue

            articles.append({
                "source":    src["name"],
                "bias":      src["bias"],
                "title":     title,
                "summary":   summary[:400],
                "link":      link,
                "published": _parse_date(entry).isoformat(),
            })

    # Sort newest first
    articles.sort(key=lambda a: a["published"], reverse=True)
    return articles
