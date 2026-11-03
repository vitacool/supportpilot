import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BROWSER =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;
const BASE = process.env.SUPPORTPILOT_URL || 'http://127.0.0.1:8788';
const OUT = path.resolve('docs/screenshots');
const PROFILE = path.resolve('.edge-profile/capture');
if (!existsSync(BROWSER)) throw new Error(`Chrome not found: ${BROWSER}`);
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(PROFILE, { recursive: true });

const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-extensions',
    '--window-size=1440,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevtools() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error('DevTools did not start');
}
await waitForDevtools();
const target = await (
  await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const errors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) {
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(
        message.params?.exceptionDetails?.exception?.description ||
          message.params?.exceptionDetails?.text ||
          'exception',
      );
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      errors.push((message.params.args || []).map((arg) => arg.value || arg.description).join(' '));
    }
    return;
  }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout ${method}`));
      }
    }, 20_000);
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed');
  return result.result?.value;
}
async function waitFor(selector, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true;
    await sleep(120);
  }
  return false;
}
async function goto(url, selector) {
  await send('Page.navigate', { url });
  await sleep(500);
  if (selector) await waitFor(selector);
  await evaluate('window.scrollTo(0,0)');
  await sleep(500);
}
async function capture(name, full = false) {
  let clip;
  if (full) {
    const width = await evaluate('window.innerWidth');
    const height = await evaluate('Math.min(Math.max(document.documentElement.scrollHeight,1000),1800)');
    clip = { x: 0, y: 0, width, height, scale: 1 };
  }
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: full,
    ...(clip ? { clip } : {}),
  });
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`captured ${name}.png`);
}
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `const s=document.createElement('style');s.textContent='*,*::before,*::after{animation-duration:0.001s!important;transition-duration:0.001s!important}';document.addEventListener('DOMContentLoaded',()=>document.head.appendChild(s));`,
  });

  await goto(`${BASE}/login`, '.login-form');
  await capture('login');
  await evaluate("document.querySelector('.login-submit')?.click()");
  await waitFor('.inbox-page', 15_000);
  await sleep(800);
  await capture('inbox');

  await evaluate(
    "[...document.querySelectorAll('.queue-filters button')].find(b => b.textContent.includes('AI 待审'))?.click()",
  );
  await sleep(700);
  await evaluate("document.querySelector('.queue-item')?.click()");
  await waitFor('.draft-textarea', 10_000);
  await sleep(500);
  await capture('copilot');

  await goto(`${BASE}/analytics`, '.kpi-grid');
  await sleep(900);
  await capture('analytics', true);

  await goto(`${BASE}/evaluation`, '.eval-metric-grid');
  await sleep(700);
  await capture('evaluation', true);

  await goto(`${BASE}/knowledge`, '.kb-main');
  await sleep(600);
  await capture('knowledge');

  await goto(`${BASE}/settings`, '.settings-grid');
  await sleep(500);
  await capture('settings', true);

  const loggedIn = await evaluate(`
    (async () => {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'customer@supportpilot.local', password: 'Support@2026' })
      });
      const payload = await response.json();
      localStorage.setItem('supportpilot_token', payload.data.token);
      return payload.data.user.name;
    })()
  `);
  console.log(`customer session: ${loggedIn}`);
  await goto(`${BASE}/portal`, '.portal-layout');
  await sleep(700);
  await capture('portal', true);

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await evaluate(`
    (async () => {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'agent@supportpilot.local', password: 'Support@2026' })
      });
      const payload = await response.json();
      localStorage.setItem('supportpilot_token', payload.data.token);
      location.href = '/inbox';
    })()
  `);
  await sleep(1200);
  await waitFor('.inbox-page');
  await capture('mobile-inbox', true);

  if (errors.length) {
    console.warn('Runtime errors:');
    errors.forEach((message) => console.warn(` - ${message}`));
  } else {
    console.log('no runtime console errors');
  }
} finally {
  try { socket.close(); } catch {}
  browser.kill();
  await sleep(250);
}
