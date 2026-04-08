# feeds.py — RSS source definitions and fetcher (stdlib XML, no feedparser)

import requests
import xml.etree.ElementTree as ET
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


def _text(el, tag: str, ns: str = "") -> str:
    """Extract text from a child element, handling optional namespaces."""
    child = el.find(f"{ns}{tag}")
    if child is not None and child.text:
        return child.text.strip()
    return ""


def _parse_rss_items(xml_text: str, max_items: int) -> list[dict]:
    """Parse RSS 2.0 or Atom feed XML into a list of raw entry dicts."""
    entries = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return entries

    # Detect Atom vs RSS
    ns_atom = "{http://www.w3.org/2005/Atom}"
    is_atom = root.tag.startswith(ns_atom) or root.tag == "feed"

    if is_atom:
        items = root.findall(f"{ns_atom}entry") or root.findall("entry")
        for item in items[:max_items]:
            title   = _text(item, "title",   ns_atom) or _text(item, "title")
            summary = _text(item, "summary", ns_atom) or _text(item, "content", ns_atom) or _text(item, "summary")
            link_el = item.find(f"{ns_atom}link") or item.find("link")
            link    = (link_el.get("href", "") if link_el is not None else "")
            pub     = _text(item, "published", ns_atom) or _text(item, "updated", ns_atom)
            entries.append({"title": title, "summary": summary, "link": link, "published": pub})
    else:
        # RSS 2.0
        channel = root.find("channel") or root
        for item in channel.findall("item")[:max_items]:
            title   = _text(item, "title")
            summary = _text(item, "description") or _text(item, "summary")
            link    = _text(item, "link")
            pub     = _text(item, "pubDate") or _text(item, "date")
            entries.append({"title": title, "summary": summary, "link": link, "published": pub})

    return entries


def _parse_date(raw: str) -> datetime:
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
    headers  = {"User-Agent": "IranDashboard/1.0 (trading research tool)"}

    for src in SOURCES:
        try:
            resp = requests.get(src["url"], headers=headers, timeout=10)
            resp.raise_for_status()
            raw_entries = _parse_rss_items(resp.text, max_per_source)
        except Exception as exc:
            print(f"[feeds] {src['name']}: {exc}")
            continue

        for entry in raw_entries:
            title   = entry.get("title", "")
            summary = entry.get("summary", "")
            link    = entry.get("link", "")

            if not _is_iran_related(title, summary):
                continue

            articles.append({
                "source":    src["name"],
                "bias":      src["bias"],
                "title":     title,
                "summary":   summary[:400],
                "link":      link,
                "published": _parse_date(entry.get("published", "")).isoformat(),
            })

    articles.sort(key=lambda a: a["published"], reverse=True)
    return articles
