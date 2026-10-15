import { PlaywrightCrawler, Configuration } from 'crawlee';
import fs from 'node:fs';
import path from 'node:path';

const START = process.argv[2] || 'https://www.resemble.ai/';
const MAX = +(process.argv[3] || 30);
const OUT = path.resolve('../../crawl');
fs.mkdirSync(OUT + '/shots', { recursive: true });
const host = new URL(START).host;
const slug = u => (new URL(u).pathname.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_/, '') || 'home').slice(0, 80);
const SKIP = /\/(blog|tag|category|author|wp-|feed|press|news)\b|\.(pdf|png|jpe?g|svg|zip|xml)$/i;

const crawler = new PlaywrightCrawler({
  maxRequestsPerCrawl: MAX,
  maxConcurrency: 2,
  respectRobotsTxtFile: true,
  navigationTimeoutSecs: 45,
  launchContext: { launchOptions: { headless: true } },
  async requestHandler({ page, request, enqueueLinks, log }) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState('networkidle').catch(() => {});
    // trigger lazy content
    for (let y = 0; y < 8; y++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(250); }
    await page.evaluate(() => scrollTo(0, 0));
    const s = slug(request.loadedUrl);
    const data = await page.evaluate(() => {
      const t = e => e.innerText.replace(/\s+/g, ' ').trim();
      const outline = [...document.querySelectorAll('h1,h2,h3,h4,p,li,a.button,a[class*=btn],button')]
        .map(e => ({ tag: e.tagName.toLowerCase(), text: t(e) })).filter(x => x.text && x.text.length < 400);
      const nav = [...document.querySelectorAll('nav a, header a')].map(a => ({ text: t(a), href: a.href })).filter(x => x.text);
      return { title: document.title, outline, nav };
    });
    fs.writeFileSync(`${OUT}/${s}.json`, JSON.stringify({ url: request.loadedUrl, ...data }, null, 1));
    await page.screenshot({ path: `${OUT}/shots/${s}.png`, fullPage: true, timeout: 30000 }).catch(e => log.warning('shot failed ' + e.message));
    log.info(`saved ${s} (${data.outline.length} blocks)`);
    await enqueueLinks({ strategy: 'same-hostname', exclude: [SKIP], transformRequestFunction: r => { r.url = r.url.split('#')[0]; return /^https?:/.test(r.url) ? r : false; } });
  },
  failedRequestHandler({ request, log }) { log.error('failed ' + request.url); }
}, new Configuration({ persistStorage: false }));

await crawler.run([START]);
console.log('done ->', OUT);
