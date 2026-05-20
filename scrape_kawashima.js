#!/usr/bin/env node
/**
 * go2senkyo.com — 「川島」候補者スクレイパー
 *
 * 動作概要:
 *   1. 検索ページのネットワークを傍受して内部 JSON API を特定 (DevTools 相当)
 *      → API が見つかれば直接呼び出して高速取得
 *      → なければ __NEXT_DATA__ → HTML スクレイピング の順でフォールバック
 *   2. ページネーションを追跡して全件取得
 *   3. URL/ID で重複除去
 *   4. go2senkyo_kawashima_full.csv に出力
 *   5. 取得件数 / 失敗 URL / 重複除去後件数 をログ出力
 *
 * 実行: node scrape_kawashima.js
 * 必要: playwright (npm install playwright)
 *       Chromium: /opt/pw-browsers/chromium-1194/chrome-linux/chrome
 *                 または CHROMIUM_PATH 環境変数で上書き可能
 */

'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

// ─── 設定 ────────────────────────────────────────────────────────────────────
const CHROME_PATH  = process.env.CHROMIUM_PATH
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SEARCH_QUERY = '川島';
const OUTPUT_CSV   = path.join(__dirname, 'go2senkyo_kawashima_full.csv');
const CONCURRENCY  = 4;          // 並列ページ取得数
const NAV_TIMEOUT  = 30_000;     // ページナビゲーションのタイムアウト(ms)
const BASE_URL     = 'https://go2senkyo.com';

// ─── 統計 ────────────────────────────────────────────────────────────────────
const stats = {
  rawCount:    0,
  dedupCount:  0,
  failedUrls:  [],
};

// ─── CSV ─────────────────────────────────────────────────────────────────────
const FIELDS = [
  'id', 'name', 'name_kana', 'party', 'prefecture',
  'election_area', 'election_type', 'status',
  'age', 'birthdate', 'win_count', 'url',
];

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v).trim().replace(/\r?\n/g, ' ');
  return (s.includes(',') || s.includes('"'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}
function toRow(obj) { return FIELDS.map(f => csvEscape(obj[f])).join(','); }

// ─── ブラウザ設定 ────────────────────────────────────────────────────────────
const LAUNCH_OPTS = {
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
};
const CTX_OPTS = {
  ignoreHTTPSErrors: true,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
           + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ja-JP',
  extraHTTPHeaders: { 'Accept-Language': 'ja,en;q=0.8' },
};

// ─── ユーティリティ ──────────────────────────────────────────────────────────
function log(msg)    { console.log(`[${new Date().toISOString()}] ${msg}`); }
function warn(msg)   { console.warn(`[WARN]  ${msg}`); }
function error(msg)  { console.error(`[ERROR] ${msg}`); }

/** JSON 内から候補者配列を再帰的に探す */
function findCandidateArray(json, depth = 0) {
  if (depth > 4) return null;
  if (Array.isArray(json) && json.length > 0 && json[0] && typeof json[0] === 'object') {
    // 名前・IDらしいキーがあるか
    const keys = Object.keys(json[0]).join(' ').toLowerCase();
    if (/name|id|seijika|kana|party|pref/.test(keys)) return json;
  }
  if (json && typeof json === 'object') {
    for (const key of ['items', 'results', 'candidates', 'seijika', 'data',
                        'politicians', 'list', 'members', 'payload']) {
      const sub = json[key];
      if (sub) {
        const r = findCandidateArray(sub, depth + 1);
        if (r) return r;
      }
    }
    // 配列を値に持つキーを探す
    for (const val of Object.values(json)) {
      if (Array.isArray(val) && val.length > 0) {
        const r = findCandidateArray(val, depth + 1);
        if (r) return r;
      }
    }
  }
  return null;
}

// ─── Step 1: API 発見（DevTools Network タブ相当） ──────────────────────────
/**
 * 検索ページをロードしながら XHR/fetch レスポンスを傍受し、
 * 候補者データを含む JSON API を探す。
 * 見つかれば { endpoint, hasNextPage } を返す。
 */
async function discoverApi(browser) {
  log('Step 1: API Discovery — 検索ページのネットワークを監視中...');
  const ctx  = await browser.newContext(CTX_OPTS);
  const page = await ctx.newPage();

  const jsonHits = [];  // { url, json, items }

  // 全レスポンスを傍受
  page.on('response', async res => {
    const url = res.url();
    const ct  = (res.headers()['content-type'] || '').toLowerCase();
    if (!ct.includes('json')) return;
    // 計測系・静的アセットは除外
    if (/google|analytics|gtm|doubleclick|ampproject|cloudfront\.net\/static|\.css|\.js$/
        .test(url)) return;
    try {
      const text = await res.text();
      if (text.length < 20) return;
      const json = JSON.parse(text);
      const items = findCandidateArray(json);
      if (items) {
        jsonHits.push({ url, json, items });
        log(`  [JSON API 候補] ${url}  →  ${items.length} 件`);
      } else if (text.length > 200) {
        log(`  [JSON] ${url}  (${text.length} bytes, 候補者配列なし)`);
      }
    } catch {}
  });

  const searchUrl = `${BASE_URL}/seijika/search?q=${encodeURIComponent(SEARCH_QUERY)}`;
  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
    // 下スクロールして遅延ロードを誘発
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  } catch (e) {
    warn(`API Discovery — ページロードエラー: ${e.message}`);
  }

  await ctx.close();

  // 最も多くの候補者を返したエンドポイントを採用
  jsonHits.sort((a, b) => b.items.length - a.items.length);
  if (jsonHits.length > 0) {
    const best = jsonHits[0];
    log(`  → API 採用: ${best.url}  (${best.items.length} 件/ページ)`);
    return best.url;
  }

  log('  → 専用 API 見つからず。HTML スクレイピングに移行。');
  return null;
}

// ─── Step 2a: API 経由の全件取得 ─────────────────────────────────────────────
async function scrapeViaApi(apiEndpoint, browser) {
  log(`Step 2a: API 経由取得 — ${apiEndpoint}`);
  const ctx  = await browser.newContext(CTX_OPTS);
  const page = await ctx.newPage();
  const all  = [];

  const base = new URL(apiEndpoint);
  base.searchParams.set('q', SEARCH_QUERY);

  // ページパラメータ名を推定（page, p, offset など）
  const pageParam = ['page', 'p', 'pg'].find(k => base.searchParams.has(k)) || 'page';
  let pageNum = 1;

  while (true) {
    base.searchParams.set(pageParam, String(pageNum));
    const url = base.toString();
    try {
      const res  = await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT });
      const text = await res.text();
      const json = JSON.parse(text);
      const items = findCandidateArray(json);
      if (!items || items.length === 0) {
        log(`  page ${pageNum}: 0 件 → 終了`);
        break;
      }
      all.push(...items);
      log(`  page ${pageNum}: ${items.length} 件  累計 ${all.length}`);
      pageNum++;
      await page.waitForTimeout(300);  // サーバー負荷軽減
    } catch (e) {
      stats.failedUrls.push(url);
      warn(`page ${pageNum} 失敗: ${e.message}`);
      break;
    }
  }

  await ctx.close();
  return all;
}

// ─── Step 2b: HTML スクレイピング ────────────────────────────────────────────

/** __NEXT_DATA__ から候補者データを抽出するヘルパー */
async function extractFromNextData(page) {
  try {
    const nd = await page.$eval('#__NEXT_DATA__', el => el.textContent);
    const json = JSON.parse(nd);
    const items = findCandidateArray(json);
    if (items) return items;
  } catch {}
  return null;
}

/** 検索結果の全ページから候補者 URL を収集 */
async function collectSearchUrls(browser) {
  log('Step 2b: 検索ページから候補者 URL を収集中...');
  const ctx  = await browser.newContext(CTX_OPTS);
  const page = await ctx.newPage();
  const urls = new Set();
  let pageNum = 1;

  while (true) {
    const url = `${BASE_URL}/seijika/search?q=${encodeURIComponent(SEARCH_QUERY)}&page=${pageNum}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });

      // __NEXT_DATA__ に候補者 URL が含まれることがある
      const ndItems = await extractFromNextData(page);
      if (ndItems) {
        ndItems.forEach(item => {
          const id = item.id ?? item.seijika_id;
          if (id) urls.add(`${BASE_URL}/seijika/${id}/`);
        });
        log(`  page ${pageNum}: __NEXT_DATA__ から ${ndItems.length} 件`);
      }

      // <a href="/seijika/{id}/"> リンクを収集
      const found = await page.$$eval('a[href]', els => {
        const re = /^\/seijika\/\d+\/?$/;
        return [...new Set(
          els.map(e => e.getAttribute('href'))
             .filter(h => h && re.test(new URL(h, location.origin).pathname))
             .map(h => new URL(h, location.origin).href)
        )];
      });
      found.forEach(u => urls.add(u));
      if (found.length === 0 && !ndItems) {
        log(`  page ${pageNum}: リンクなし → 終了`);
        break;
      }
      log(`  page ${pageNum}: ${found.length} リンク収集  累計 ${urls.size}`);

      // 次ページ確認
      const nextSel = [
        `a[href*="page=${pageNum + 1}"]`,
        'a.next', 'a[rel=next]',
        '.pagination a:last-child',
        '[data-testid="next-page"]',
      ].join(', ');
      const hasNext = await page.$(nextSel);
      if (!hasNext) { log('  次ページなし → 終了'); break; }

      pageNum++;
      await page.waitForTimeout(500);
    } catch (e) {
      stats.failedUrls.push(url);
      warn(`page ${pageNum} 失敗: ${e.message}`);
      break;
    }
  }

  await ctx.close();
  return [...urls];
}

/** 候補者プロフィールページから詳細情報を取得 */
async function scrapeProfile(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

    // ID を URL から取得
    const idMatch = url.match(/\/seijika\/(\d+)/);
    const id = idMatch?.[1] ?? '';

    // ① __NEXT_DATA__ から取得を優先（高精度）
    const ndItems = await extractFromNextData(page);
    if (ndItems) {
      const item = ndItems.find(i => String(i.id ?? i.seijika_id) === id) ?? ndItems[0];
      if (item) {
        return normalizeApiItem(item, url);
      }
    }

    // ② DOM スクレイピング（フォールバック）
    const data = await page.evaluate(() => {
      const text = sel => document.querySelector(sel)?.textContent?.trim() ?? '';
      const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) ?? '';

      // 氏名（h1 または og:title から）
      const name = text('h1') ||
        document.querySelector('meta[property="og:title"]')?.content?.split(/[|\-]/)[0]?.trim() || '';

      // ふりがな
      const name_kana = text('.kana, [class*="kana"], ruby rt, .reading, [class*="yomi"]');

      // 政党
      const party = text('.party-name, [class*="party"], [class*="seitou"], '
                        + '.belonging, [class*="belong"], [class*="group"]');

      // 都道府県・選挙区
      const prefecture = text('[class*="pref"], [class*="prefecture"], [class*="ken"]');
      const election_area = text('[class*="area"], [class*="district"], [class*="senkyoku"]');

      // 選挙種別
      const election_type = text('[class*="election-type"], [class*="electionType"], '
                                + '[class*="senkyo_shubetsu"]');

      // 現職/新人/元職
      const status = text('[class*="status"], [class*="genshoku"], [class*="incumbent"], '
                         + '.tag-status, [class*="career-status"]');

      // 年齢・生年月日
      const ageBlock = text('[class*="age"], [class*="birth"], [class*="nenrei"]');
      const ageMatch    = ageBlock.match(/(\d{1,3})歳/);
      const age         = ageMatch?.[1] ?? '';
      const birthMatch  = ageBlock.match(/(\d{4})[年\/](\d{1,2})[月\/](\d{1,2})/);
      const birthdate   = birthMatch
        ? `${birthMatch[1]}-${birthMatch[2].padStart(2,'0')}-${birthMatch[3].padStart(2,'0')}`
        : '';

      // 当選回数
      const winBlock  = text('[class*="win"], [class*="tosen"], [class*="elected"]');
      const winMatch  = winBlock.match(/(\d+)\s*回/);
      const win_count = winMatch?.[1] ?? '';

      return { name, name_kana, party, prefecture, election_area,
               election_type, status, age, birthdate, win_count };
    });

    return { id, url, ...data };
  } catch (e) {
    stats.failedUrls.push(url);
    warn(`プロフィール取得失敗 ${url}: ${e.message}`);
    return null;
  }
}

/** API レスポンスのアイテムを正規化 */
function normalizeApiItem(item, url) {
  const id = String(item.id ?? item.seijika_id ?? item.politician_id ?? '');
  return {
    id,
    name:          item.name          ?? item.seijika_name   ?? item.full_name   ?? '',
    name_kana:     item.name_kana     ?? item.kana           ?? item.yomi        ?? '',
    party:         item.party         ?? item.party_name     ?? item.seitou      ?? '',
    prefecture:    item.prefecture    ?? item.pref           ?? item.ken         ?? '',
    election_area: item.election_area ?? item.area_name      ?? item.senkyoku    ?? '',
    election_type: item.election_type ?? item.type           ?? item.shubetsu    ?? '',
    status:        item.status        ?? item.genshoku       ?? item.incumbent   ?? '',
    age:           String(item.age    ?? ''),
    birthdate:     item.birthdate     ?? item.birthday       ?? item.birth       ?? '',
    win_count:     String(item.win_count ?? item.tosen_count ?? item.elected_count ?? ''),
    url:           url ?? (id ? `${BASE_URL}/seijika/${id}/` : ''),
  };
}

/** URL リストを CONCURRENCY 並列で処理 */
async function scrapeProfiles(urls, browser) {
  log(`${urls.length} 件のプロフィールを並列取得中 (concurrency=${CONCURRENCY})...`);
  const results = [];
  const queue   = [...urls];
  let done = 0;

  async function worker() {
    const ctx  = await browser.newContext(CTX_OPTS);
    const page = await ctx.newPage();
    while (queue.length > 0) {
      const url = queue.shift();
      const rec = await scrapeProfile(page, url);
      done++;
      if (rec) results.push(rec);
      process.stdout.write(
        `\r  取得済: ${done}/${urls.length}  成功: ${results.length}  失敗: ${stats.failedUrls.length}  `
      );
      await page.waitForTimeout(200);  // サーバー負荷軽減
    }
    await ctx.close();
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  process.stdout.write('\n');
  return results;
}

// ─── メイン ──────────────────────────────────────────────────────────────────
(async () => {
  const startTime = Date.now();
  console.log('='.repeat(64));
  console.log(' go2senkyo.com 川島候補者スクレイパー');
  console.log('='.repeat(64));

  const browser = await chromium.launch(LAUNCH_OPTS);
  let rawRecords = [];

  try {
    // ── Step 1: API 発見 ────────────────────────────────────────────────────
    const apiEndpoint = await discoverApi(browser);

    // ── Step 2: データ取得 ──────────────────────────────────────────────────
    if (apiEndpoint) {
      // API 経由
      const apiItems = await scrapeViaApi(apiEndpoint, browser);
      rawRecords = apiItems.map(item => normalizeApiItem(item,
        item.url ?? `${BASE_URL}/seijika/${item.id ?? item.seijika_id ?? ''}/`));
    } else {
      // HTML スクレイピング
      const profileUrls = await collectSearchUrls(browser);
      if (profileUrls.length === 0) {
        error('候補者 URL が見つかりませんでした。\n'
            + '  → go2senkyo.com へのネットワークアクセスを確認してください。\n'
            + '  → 環境変数 CHROMIUM_PATH でブラウザパスを上書きできます。');
        await browser.close();
        process.exit(1);
      }
      rawRecords = (await scrapeProfiles(profileUrls, browser)).filter(Boolean);
    }
  } finally {
    await browser.close();
  }

  stats.rawCount = rawRecords.length;

  // ── Step 3: 重複除去 ──────────────────────────────────────────────────────
  const seen = new Map();
  for (const rec of rawRecords) {
    // id が取れていれば id、なければ URL を dedup キーに使用
    const key = (rec.id && rec.id !== '') ? `id:${rec.id}` : `url:${rec.url}`;
    if (!seen.has(key)) seen.set(key, rec);
  }
  const dedupRecords = [...seen.values()];
  stats.dedupCount = dedupRecords.length;

  // ── Step 4: CSV 出力 ───────────────────────────────────────────────────────
  const lines = [FIELDS.join(','), ...dedupRecords.map(toRow)];
  fs.writeFileSync(OUTPUT_CSV, lines.join('\n') + '\n', 'utf8');

  // ── ログサマリー ────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(64));
  console.log(' 結果サマリー');
  console.log('='.repeat(64));
  console.log(`  取得件数 (重複除去前):   ${stats.rawCount}`);
  console.log(`  重複除去後件数:           ${stats.dedupCount}`);
  console.log(`  重複件数:                 ${stats.rawCount - stats.dedupCount}`);
  console.log(`  失敗 URL 数:             ${stats.failedUrls.length}`);
  if (stats.failedUrls.length > 0) {
    console.log('\n  失敗 URL 一覧:');
    stats.failedUrls.forEach((u, i) => console.log(`    ${String(i + 1).padStart(3)}. ${u}`));
  }
  console.log(`\n  出力ファイル: ${OUTPUT_CSV}`);
  console.log(`  実行時間: ${elapsed}s`);
  console.log('='.repeat(64));
})();
