import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const B='http://localhost:5173/';
await p.goto(B+'login.html'); await p.screenshot({ path: '../../crawl/s-login.png' });
await p.goto(B); await p.screenshot({ path: '../../crawl/s-land.png', fullPage: true });
await b.close();
