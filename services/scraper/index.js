import 'dotenv/config';
import fetch from 'node-fetch';
import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 1 });
const target = process.env.SCRAPER_SEED_URL || 'https://example.com/sitemap.xml';

async function fetchHead(url) {
  const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': process.env.USER_AGENT || 'ODA-Storefront-Scraper/0.1' } });
  return { url, status: res.status };
}

queue.add(() => fetchHead(target))
  .then((result) => console.log('[scraper-stub] fetched', result))
  .catch((err) => console.error('[scraper-stub] error', err))
  .finally(() => {
    queue.clear();
    queue.onIdle().then(() => process.exit(0));
  });
