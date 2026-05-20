#!/usr/bin/env node
/**
 * モックサーバーを立てて scrape_kawashima.js のロジックを検証する
 * 実行: node test_mock.js
 */
'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { chromium } = require('playwright');

const CHROME_PATH = process.env.CHROMIUM_PATH
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// ─── モックデータ ─────────────────────────────────────────────────────────────
const MOCK_CANDIDATES = [
  { id: '1001', name: '川島 太郎', name_kana: 'かわしま たろう', party: '○○党',
    prefecture: '東京都', election_area: '東京1区', election_type: '衆議院',
    status: '現職', age: '55', birthdate: '1970-04-01', win_count: '3' },
  { id: '1002', name: '川島 花子', name_kana: 'かわしま はなこ', party: '△△党',
    prefecture: '大阪府', election_area: '大阪3区', election_type: '参議院',
    status: '新人', age: '42', birthdate: '1983-09-15', win_count: '0' },
  { id: '1003', name: '川島 一郎', name_kana: 'かわしま いちろう', party: '○○党',
    prefecture: '愛知県', election_area: '愛知2区', election_type: '衆議院',
    status: '元職', age: '68', birthdate: '1957-12-03', win_count: '2' },
  // 重複テスト用（id:1001 の重複）
  { id: '1001', name: '川島 太郎（重複）', name_kana: 'かわしま たろう', party: '○○党',
    prefecture: '東京都', election_area: '東京1区', election_type: '衆議院',
    status: '現職', age: '55', birthdate: '1970-04-01', win_count: '3' },
];

// ─── モック HTTP サーバー ────────────────────────────────────────────────────
function createMockServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // 検索ページ（HTML + 候補者リンク埋め込み）
    if (url.pathname === '/seijika/search') {
      const links = MOCK_CANDIDATES
        .filter((_, i) => i < 3)  // 重複候補は除く
        .map(c => `<a href="/seijika/${c.id}/">${c.name}</a>`)
        .join('\n');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body><h1>検索結果</h1>${links}</body></html>`);
      return;
    }

    // 候補者プロフィールページ
    const profileMatch = url.pathname.match(/^\/seijika\/(\d+)\/?$/);
    if (profileMatch) {
      const id = profileMatch[1];
      const c  = MOCK_CANDIDATES.find(x => x.id === id);
      if (!c) { res.writeHead(404); res.end('Not Found'); return; }

      // __NEXT_DATA__ を埋め込み（本番サイトの Next.js と同じ形式）
      const nextData = JSON.stringify({ props: { pageProps: { candidates: [c] } } });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><head></head><body>
        <h1>${c.name}</h1>
        <script id="__NEXT_DATA__" type="application/json">${nextData}</script>
      </body></html>`);
      return;
    }

    // JSON API エンドポイント（DevTools で発見されるケース）
    if (url.pathname === '/api/seijika/search') {
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const items = page === 1 ? MOCK_CANDIDATES : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: items, total: MOCK_CANDIDATES.length }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });
  return server;
}

// ─── テスト実行 ──────────────────────────────────────────────────────────────
async function runTest(useApi) {
  const server = createMockServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base  = `http://127.0.0.1:${port}`;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`テスト: ${useApi ? 'API モード' : 'HTML スクレイピングモード'}`);
  console.log(`モックサーバー: ${base}`);
  console.log('='.repeat(60));

  // scrape_kawashima.js の関数群を BASE_URL を差し替えてインポート
  // 直接モジュール化していないため、ロジックをここで再実装して検証
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx  = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  const stats = { rawCount: 0, dedupCount: 0, failedUrls: [] };
  const rawRecords = [];

  // API モードのテスト
  if (useApi) {
    let p = 1;
    while (true) {
      const url = `${base}/api/seijika/search?q=%E5%B7%9D%E5%B3%B6&page=${p}`;
      try {
        const res  = await page.goto(url, { timeout: 10000 });
        const json = JSON.parse(await res.text());
        const items = json.results ?? [];
        if (items.length === 0) break;
        rawRecords.push(...items.map(item => ({
          id: item.id, name: item.name, name_kana: item.name_kana,
          party: item.party, prefecture: item.prefecture,
          election_area: item.election_area, election_type: item.election_type,
          status: item.status, age: item.age, birthdate: item.birthdate,
          win_count: item.win_count, url: `${base}/seijika/${item.id}/`,
        })));
        p++;
      } catch (e) { stats.failedUrls.push(url); break; }
    }
  } else {
    // HTML スクレイピングモード
    await page.goto(`${base}/seijika/search?q=%E5%B7%9D%E5%B3%B6`, { timeout: 10000 });
    const links = await page.$$eval('a[href]', (els, base) =>
      [...new Set(els.map(e => new URL(e.getAttribute('href'), base).href)
                     .filter(h => /\/seijika\/\d+\/?$/.test(new URL(h).pathname)))],
      base
    );
    console.log(`  収集リンク: ${links.length} 件`);

    for (const url of links) {
      try {
        await page.goto(url, { timeout: 10000 });
        const ndText = await page.$eval('#__NEXT_DATA__', el => el.textContent);
        const nd = JSON.parse(ndText);
        const items = nd.props?.pageProps?.candidates ?? [];
        if (items[0]) {
          rawRecords.push({ ...items[0], url });
        }
      } catch (e) {
        stats.failedUrls.push(url);
        console.warn(`  失敗: ${url}:`, e.message);
      }
    }
  }

  await ctx.close();
  await browser.close();
  server.close();

  stats.rawCount = rawRecords.length;

  // 重複除去
  const seen = new Map();
  for (const rec of rawRecords) {
    const key = rec.id ? `id:${rec.id}` : `url:${rec.url}`;
    if (!seen.has(key)) seen.set(key, rec);
  }
  const dedup = [...seen.values()];
  stats.dedupCount = dedup.length;

  // CSV 出力（テスト用）
  const FIELDS = ['id','name','name_kana','party','prefecture','election_area',
                  'election_type','status','age','birthdate','win_count','url'];
  const esc = v => {
    const s = String(v ?? '').trim();
    return (s.includes(',') || s.includes('"')) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const csvPath = path.join(__dirname, `go2senkyo_kawashima_full_test_${useApi?'api':'html'}.csv`);
  const lines = [FIELDS.join(','), ...dedup.map(r => FIELDS.map(f => esc(r[f])).join(','))];
  fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf8');

  // サマリー
  console.log('\n結果サマリー:');
  console.log(`  取得件数 (重複除去前): ${stats.rawCount}`);
  console.log(`  重複除去後件数:         ${stats.dedupCount}`);
  console.log(`  重複件数:               ${stats.rawCount - stats.dedupCount}`);
  console.log(`  失敗 URL 数:           ${stats.failedUrls.length}`);
  if (stats.failedUrls.length > 0) {
    stats.failedUrls.forEach((u, i) => console.log(`    ${i+1}. ${u}`));
  }
  console.log(`  出力: ${csvPath}`);

  // 検証
  const EXPECTED_DEDUP = 3;
  const ok = stats.dedupCount === EXPECTED_DEDUP;
  console.log(`\n  [${ok ? '✓ PASS' : '✗ FAIL'}] 期待値: ${EXPECTED_DEDUP} 件、実際: ${stats.dedupCount} 件`);
  return ok;
}

(async () => {
  let allPass = true;
  allPass &= await runTest(true);   // API モード
  allPass &= await runTest(false);  // HTML モード
  console.log(`\n${'='.repeat(60)}`);
  console.log(`全テスト: ${allPass ? '✓ PASS' : '✗ FAIL'}`);
  console.log('='.repeat(60));
  process.exit(allPass ? 0 : 1);
})();
