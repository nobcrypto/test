// Probe go2senkyo.com to discover API endpoints and page structure
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function probe() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  const apiCalls = [];
  page.on('request', req => {
    const url = req.url();
    if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch' ||
        url.includes('api') || url.includes('search') || url.includes('json')) {
      apiCalls.push({ method: req.method(), url, type: req.resourceType() });
    }
  });
  page.on('response', async res => {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    if (ct.includes('json') && !url.includes('gtm') && !url.includes('analytics')) {
      try {
        const body = await res.text();
        if (body.length > 50) {
          console.log('[JSON API]', url);
          console.log('  preview:', body.slice(0, 300));
        }
      } catch {}
    }
  });

  console.log('=== Probing top page ===');
  await page.goto('https://go2senkyo.com', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('Title:', await page.title());
  console.log('URL:', page.url());

  console.log('\n=== Searching for 川島 ===');
  await page.goto('https://go2senkyo.com/seijika/search?q=%E5%B7%9D%E5%B3%B6', {
    waitUntil: 'networkidle', timeout: 30000
  });
  console.log('Search URL:', page.url());
  console.log('Title:', await page.title());

  // Extract page structure
  const html = await page.content();
  const truncated = html.slice(0, 3000);
  console.log('\n=== HTML snippet ===');
  console.log(truncated);

  // Look for candidate links
  const links = await page.$$eval('a[href*="/seijika/"]', els =>
    els.map(e => ({ text: e.textContent.trim().slice(0, 50), href: e.href })).slice(0, 20)
  );
  console.log('\n=== Candidate links ===');
  links.forEach(l => console.log(l.href, '|', l.text));

  console.log('\n=== All API calls ===');
  apiCalls.forEach(c => console.log(c.method, c.type, c.url));

  await browser.close();
}

probe().catch(console.error);
