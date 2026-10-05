// Tiny screenshot sidecar for Workshop's Design Mode. Loads a page through
// Workshop's preview port (cookie-authenticated) and screenshots one element.
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT) || 3100;
const PREVIEW_URL = process.env.WORKSHOP_PREVIEW_URL;
if (!PREVIEW_URL) {
  console.error('WORKSHOP_PREVIEW_URL is required');
  process.exit(1);
}

const MAX_BODY = 64 * 1024;
const clamp = (n) => Math.min(4000, Math.max(100, n));
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

class ShotError extends Error {}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleShot(req, res, browser) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end(err.message);
    return;
  }

  let data;
  try {
    data = JSON.parse(body.toString('utf8'));
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('invalid json');
    return;
  }

  const { target, path, selector, width, height, token } = data;
  if (
    typeof target !== 'string' ||
    typeof path !== 'string' ||
    typeof selector !== 'string' ||
    typeof token !== 'string' ||
    !path.startsWith('/') ||
    !isFiniteNum(width) ||
    !isFiniteNum(height)
  ) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('invalid request body');
    return;
  }

  const context = await browser.newContext({
    viewport: { width: clamp(width), height: clamp(height) },
  });
  try {
    await context.addCookies([{ name: 'workshop_token', value: token, url: PREVIEW_URL }]);
    const page = await context.newPage();
    const startUrl = `${PREVIEW_URL}/__workshop/start?target=${encodeURIComponent(target)}&path=${encodeURIComponent(path)}`;
    await page.goto(startUrl, { waitUntil: 'load', timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

    const image = await page
      .locator(selector)
      .first()
      .screenshot({ timeout: 10_000, animations: 'disabled' })
      .catch((err) => {
        throw new ShotError(err.message);
      });

    res.writeHead(200, { 'content-type': 'image/png' }).end(image);
  } catch (err) {
    const status = err instanceof ShotError ? 422 : 500;
    res.writeHead(status, { 'content-type': 'text/plain' }).end(err.message);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method === 'POST' && req.url === '/shot') {
    handleShot(req, res, browser).catch((err) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end(err.message);
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`workshop-playwright listening on ${PORT}`);
});

process.on('SIGTERM', async () => {
  server.close();
  await browser.close();
  process.exit(0);
});
