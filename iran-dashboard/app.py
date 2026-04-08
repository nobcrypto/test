# app.py — Flask application entry point

from __future__ import annotations
import threading
import time
from flask import Flask, jsonify, render_template, request

from feeds import fetch_all_feeds
from analyzer import score_article, aggregate
from demo_data import DEMO_ARTICLES

app = Flask(__name__)

# ---------------------------------------------------------------------------
# In-memory cache (refreshed every 5 minutes by background thread)
# ---------------------------------------------------------------------------

_cache: dict = {
    "articles":  [],
    "summary":   {},
    "last_fetch": None,
}
_lock = threading.Lock()


def _refresh():
    articles = fetch_all_feeds()
    # Fall back to demo data when no live feeds are reachable
    if not articles:
        print("[app] No live articles fetched — using demo data")
        articles = list(DEMO_ARTICLES)
    scored   = [score_article(a) for a in articles]
    summary  = aggregate(scored)
    with _lock:
        _cache["articles"]   = scored
        _cache["summary"]    = summary
        _cache["last_fetch"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _background_loop(interval: int = 300):
    while True:
        try:
            _refresh()
        except Exception as exc:
            print(f"[refresh error] {exc}")
        time.sleep(interval)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/articles")
def api_articles():
    bias_filter   = request.args.get("bias", "all")
    signal_filter = request.args.get("signal", "").strip().lower()
    limit         = int(request.args.get("limit", 100))

    with _lock:
        articles = list(_cache["articles"])

    if bias_filter != "all":
        articles = [a for a in articles if a["bias"] == bias_filter]

    if signal_filter:
        articles = [
            a for a in articles
            if any(signal_filter in s.lower() for s in a.get("signals", []))
            or signal_filter in a["title"].lower()
        ]

    return jsonify(articles[:limit])


@app.route("/api/summary")
def api_summary():
    with _lock:
        return jsonify({**_cache["summary"], "last_fetch": _cache["last_fetch"]})


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    """Manual refresh trigger."""
    threading.Thread(target=_refresh, daemon=True).start()
    return jsonify({"status": "refresh started"})


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Initial fetch in background so server starts immediately
    t = threading.Thread(target=_background_loop, args=(300,), daemon=True)
    t.start()
    # First fetch immediately
    threading.Thread(target=_refresh, daemon=True).start()
    app.run(host="0.0.0.0", port=5050, debug=False)
