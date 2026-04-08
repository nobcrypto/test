# demo_data.py — sample articles for offline / proxy-blocked environments

from datetime import datetime, timezone, timedelta

def _ago(minutes: int) -> str:
    t = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    return t.isoformat()

DEMO_ARTICLES = [
    {
        "source": "Reuters World", "bias": "neutral",
        "title": "Iran warns of 'decisive response' if nuclear sites targeted amid rising tensions",
        "summary": "Iran's foreign minister warned Monday that any military strike on its nuclear facilities would trigger a decisive response, as the IAEA reported enrichment levels at Fordow had reached 84%, just below weapons-grade.",
        "link": "#", "published": _ago(15),
    },
    {
        "source": "Al Jazeera", "bias": "me_focus",
        "title": "US warships transit Strait of Hormuz as Iran conducts naval exercises",
        "summary": "Two US Navy destroyers passed through the Strait of Hormuz on Tuesday while Iran's IRGC conducted simultaneous naval drills nearby. Oil futures jumped 2.3% on the news as traders priced in supply disruption risk.",
        "link": "#", "published": _ago(42),
    },
    {
        "source": "Times of Israel", "bias": "il_focus",
        "title": "Israel signals readiness to strike Iran enrichment sites within weeks — report",
        "summary": "Israeli security cabinet has approved contingency plans for a pre-emptive strike on Iran's Natanz and Fordow enrichment facilities, according to Channel 12. The IDF has completed a second round of long-range drill exercises.",
        "link": "#", "published": _ago(78),
    },
    {
        "source": "OilPrice.com", "bias": "energy",
        "title": "Crude surges on Iran-Israel escalation fears; Brent eyes $95 resistance",
        "summary": "Brent crude rose 3.1% to $93.40/barrel Wednesday as geopolitical risk premium returned to energy markets. Iran accounts for roughly 3 mb/d of global output; any Hormuz disruption could remove 20% of seaborne oil flows.",
        "link": "#", "published": _ago(110),
    },
    {
        "source": "ForexLive", "bias": "market",
        "title": "Gold hits 2-month high as Iran nuclear standoff rattles risk appetite",
        "summary": "XAU/USD climbed to $2,387 on safe-haven buying. USD/JPY fell 0.6% as yen demand rose. Traders are watching IAEA emergency board meeting scheduled for Thursday for any snap-back trigger language.",
        "link": "#", "published": _ago(135),
    },
    {
        "source": "Middle East Eye", "bias": "me_focus",
        "title": "Houthi forces claim new drone attack on oil tanker in Red Sea",
        "summary": "Yemen's Houthi movement said it struck a Liberian-flagged tanker with two anti-ship drones in the Gulf of Aden. Shipping insurance premiums for the region surged 40% week-on-week.",
        "link": "#", "published": _ago(190),
    },
    {
        "source": "Reuters World", "bias": "neutral",
        "title": "EU, US resume indirect nuclear talks with Iran in Geneva — sources",
        "summary": "European diplomats confirmed that indirect talks between Iran and the P4+1 group resumed in Geneva on Wednesday, raising cautious hopes for a partial JCPOA revival. Iran demanded sanctions relief on oil exports as a prerequisite.",
        "link": "#", "published": _ago(250),
    },
    {
        "source": "Haaretz", "bias": "il_focus",
        "title": "IRGC announces new ballistic missile with 2,000km range capable of hitting southern Europe",
        "summary": "Iran's Islamic Revolutionary Guard Corps unveiled the Fattah-2 hypersonic ballistic missile with a declared range of 2,000 km and a maneuverable re-entry vehicle, complicating existing missile defense architectures.",
        "link": "#", "published": _ago(320),
    },
    {
        "source": "AP Top News", "bias": "neutral",
        "title": "US Treasury imposes new sanctions on Iranian oil export network",
        "summary": "The Treasury Department designated 12 entities and 8 vessels linked to Iran's shadow oil export network, targeting shipments to East Asian buyers. The move tightens enforcement of existing crude oil embargoes.",
        "link": "#", "published": _ago(410),
    },
    {
        "source": "PressTV", "bias": "ir_state",
        "title": "Iran FM: JCPOA revival possible only with full sanction removal — no partial deals",
        "summary": "Iranian Foreign Minister Abbas Araghchi said Tehran would not accept phased sanctions removal, insisting that a comprehensive lifting of all economic restrictions was the minimum condition for any nuclear agreement.",
        "link": "#", "published": _ago(480),
    },
    {
        "source": "OilPrice.com", "bias": "energy",
        "title": "OPEC+ considers emergency cut if Iran sanctions relief floods market",
        "summary": "Saudi Arabia signaled readiness to deepen OPEC+ output cuts by 500,000 b/d should a nuclear deal allow Iran to rapidly restore 1-1.5 mb/d of sanctioned exports, according to delegates familiar with the discussions.",
        "link": "#", "published": _ago(560),
    },
    {
        "source": "Middle East Eye", "bias": "me_focus",
        "title": "Iran deploys additional anti-ship missiles along Persian Gulf coastline",
        "summary": "Satellite imagery analyzed by defense think-tanks shows Iran has positioned additional Noor and Qader anti-ship missile batteries at three sites overlooking the Strait of Hormuz over the past 10 days.",
        "link": "#", "published": _ago(640),
    },
]
