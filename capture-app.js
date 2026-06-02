/**
 * capture-app.js - Autonomous Screenshot Tool for CityWithLifeGrok
 *
 * Hardened for fleet reliability (Capture Tool Hardening & Reliability Agent, 2026-05-31).
 * Key improvements:
 * - Pre-flight dev server readiness poll (TCP connect on 5173 + content check) before any navigation.
 * - Smarter ECONNREFUSED handling with explicit guidance for tool-managed background dev launches.
 * - Enhanced failure diagnostics: page title, God panel text snippet, canvas pixel stats.
 * - --stable-wait mode (higher defaults: wait 5500+, retries 5, longer polls) for long-running agents.
 * - Better defaults (wait 3200, retries 4) tuned from 83%→100% reliability data on stable dev.
 *
 * Usage examples (recommended for agents):
 *   node capture-app.js --target god-mode --label "capture-hardening-01" --wait 5500 --retries 5
 *   node capture-app.js --target crown --label "capture-hardening-02" --stable-wait
 *   node capture-app.js --target inspector --retries 4
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import net from 'net';  // for TCP port readiness polling (dev server detection)
import http from 'http';  // for lightweight content pre-check (ESM built-in)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mapping of friendly names to CSS selectors (best effort)
const TARGETS = {
  full: null,
  canvas: '#city-canvas',
  'god-mode': '#god-mode-tools, .god-mode-tools',
  inspector: '#business-inspector, #inspector-mount, .business-inspector, .resident-inspector',
  crown: '#god-mode-tools',
  debug: '#debug-panel',
};

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    target: 'full',
    selector: null,
    label: 'capture',
    wait: 3200,      // tuned default from reliability data (higher than original 2500 for stable dev)
    retries: 4,      // tuned default (higher for agent use; was 3)
    headless: true,
    stableWait: false,
    port: 5173,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target' || arg === '-t') {
      options.target = args[++i] || 'full';
    } else if (arg === '--selector' || arg === '-s') {
      options.selector = args[++i];
    } else if (arg === '--label' || arg === '-l') {
      options.label = args[++i] || 'capture';
    } else if (arg === '--wait' || arg === '-w') {
      options.wait = parseInt(args[++i], 10) || 3200;
    } else if (arg === '--retries' || arg === '-r') {
      options.retries = parseInt(args[++i], 10) || 4;
    } else if (arg === '--stable-wait' || arg === '--stable') {
      options.stableWait = true;
    } else if (arg === '--port') {
      options.port = parseInt(args[++i], 10) || 5173;
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '--no-headless') {
      options.headless = false;
    } else if (!arg.startsWith('-')) {
      if (options.label === 'capture') options.label = arg;
    }
  }

  if (options.stableWait) {
    // Long-running agent / fleet use: higher wait + retries + tolerant poll
    options.wait = Math.max(options.wait, 5500);
    options.retries = Math.max(options.retries, 5);
  }

  return options;
}

/**
 * Pre-flight readiness check: polls TCP connect to localhost:port until the dev server is actually listening.
 * This is the #1 reliability win from the capture-reliability-01 agent (100% success on stable tool-bg dev).
 * Returns true if ready; throws helpful error after timeout (with guidance for agents).
 */
async function waitForDevServerReady(port = 5173, maxWaitMs = 35000, label = 'capture') {
  const start = Date.now();
  const pollMs = 650; // slightly slower than content poller to be kind to OS

  console.log(`[capture-app] Pre-flight: waiting for dev server on :${port} (max ${maxWaitMs}ms)...`);

  while (Date.now() - start < maxWaitMs) {
    const ok = await new Promise(resolve => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {
        sock.end();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        resolve(false);
      });
      // hard timeout per attempt
      setTimeout(() => { try { sock.destroy(); } catch (_) {} resolve(false); }, 900);
    });

    if (ok) {
      console.log(`[capture-app] ✅ Dev server detected listening on :${port}`);
      return true;
    }

    await new Promise(r => setTimeout(r, pollMs));
  }

  const guidance = `
Dev server NOT listening on :${port} after ${maxWaitMs}ms.
For agents using run_terminal_command:
  1. Kill stale: Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
  2. Clear caches: Remove-Item -Recurse -Force node_modules\\.vite, .vite -ErrorAction SilentlyContinue
  3. Launch in BACKGROUND via tool: $p = Start-Process cmd -ArgumentList '/c','npm run dev -- --force' -PassThru -WindowStyle Hidden
  4. Wait 12-18s then retry this capture with --wait 5500 --retries 5 --stable-wait
Or use start-dev-server.ps1 (right-click) for a persistent foreground instance.
This was the root cause in the 83% overall reliability run (100% once dev was stable).
`;
  console.error(`[capture-app] ❌ ${guidance}`);
  throw new Error(`Dev server not ready on :${port} (see guidance above)`);
}

/**
 * Lightweight content pre-check (used after port is ready but before expensive puppeteer goto).
 * Simple HEAD-like fetch to confirm HTML is serving (helps catch partial boots).
 */
function quickServerContentCheck(port = 5173) {
  return new Promise(resolve => {
    const req = http.get({ hostname: 'localhost', port, path: '/', timeout: 2200 }, (res) => {
      const ok = res.statusCode >= 200 && res.statusCode < 500;
      res.resume();
      resolve(ok);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { try { req.destroy(); } catch (_) {} resolve(false); });
  }).catch(() => false);
}

async function capture() {
  const opts = parseArgs();
  const screenshotsDir = path.join(__dirname, 'screenshots');

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `app-${opts.label}-${opts.target}-${timestamp}.png`;
  const filepath = path.join(screenshotsDir, filename);

  console.log(`[capture-app] Starting capture...`);
  console.log(`  Target : ${opts.target}`);
  console.log(`  Label  : ${opts.label}`);
  console.log(`  Wait   : ${opts.wait}ms`);
  if (opts.stableWait) console.log(`  Mode   : --stable-wait (long-running agent tuned)`);
  console.log(`  Port   : ${opts.port}`);

  // === NEW: Pre-flight dev server readiness (hardening win) ===
  await waitForDevServerReady(opts.port, 38000, opts.label);

  // Quick content sanity (non-fatal)
  const contentOk = await quickServerContentCheck(opts.port);
  if (!contentOk) {
    console.warn(`[capture-app] quickServerContentCheck returned false — may be early boot; continuing with extra wait.`);
  }

  const browser = await puppeteer.launch({
    headless: opts.headless,
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  let lastError = null;

  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    try {
      console.log(`[capture-app] Attempt ${attempt}/${opts.retries} ...`);

      // Fresh navigation each retry (helps with stale renders)
      await page.goto(`http://localhost:${opts.port}/`, {
        waitUntil: 'networkidle0',
        timeout: 45000,
      });

      // Initial fixed wait (agents often pass --wait 4000+; stable-wait pushes higher)
      await new Promise(r => setTimeout(r, opts.wait));

      // Smart content wait: poll for God panel or canvas to actually be alive
      await waitForContentReady(page, opts.target, opts.stableWait ? 12000 : 8000);

      let screenshotOptions = { path: filepath };

      if (opts.selector) {
        console.log(`[capture-app] Capturing custom selector: ${opts.selector}`);
        const element = await page.$(opts.selector);
        if (element) {
          await element.screenshot(screenshotOptions);
        } else {
          console.warn(`[capture-app] Selector not found. Full page fallback.`);
          await page.screenshot({ ...screenshotOptions, fullPage: true });
        }
      } else if (opts.target === 'full' || !TARGETS[opts.target]) {
        console.log(`[capture-app] Capturing full page...`);
        await page.screenshot({ ...screenshotOptions, fullPage: true });
      } else {
        const selector = TARGETS[opts.target];
        console.log(`[capture-app] Capturing target "${opts.target}" → ${selector}`);
        const element = await page.$(selector);
        if (element) {
          await element.screenshot(screenshotOptions);
        } else {
          console.warn(`[capture-app] Target element not found. Full page fallback.`);
          await page.screenshot({ ...screenshotOptions, fullPage: true });
        }
      }

      await browser.close();

      console.log(`\n✅ Screenshot saved successfully! (attempt ${attempt})`);
      console.log(`   File: ${filename}`);
      console.log(`   Path: ${filepath}\n`);

      return filepath;

    } catch (error) {
      lastError = error;
      console.warn(`[capture-app] Attempt ${attempt} failed: ${error.message}`);

      // === NEW: Enhanced diagnostics on every failure (title + God snippet + canvas stats) ===
      try {
        const title = await page.title().catch(() => 'N/A (no DOM)');
        const godSnippet = await page.evaluate(() => {
          const g = document.querySelector('#god-mode-tools, .god-mode-tools, #debug-panel');
          return g ? (g.textContent || '').replace(/\s+/g, ' ').slice(0, 160) : '(no god panel found)';
        }).catch(() => '(eval blocked)');
        const canvasStats = await page.evaluate(() => {
          const c = document.querySelector('#city-canvas');
          if (!c) return '(no canvas)';
          const ctx = c.getContext && c.getContext('2d');
          if (!ctx) return 'canvas(no-2d-ctx)';
          try {
            const d = ctx.getImageData(8, 8, 6, 6).data;
            let sum = 0, nonWhite = 0;
            for (let i = 0; i < d.length; i += 4) {
              sum += d[i] + d[i+1] + d[i+2];
              if (d[i] < 230 || d[i+1] < 230 || d[i+2] < 230) nonWhite++;
            }
            return `canvas(pixels=${d.length/4} sum=${sum} nonWhite=${nonWhite})`;
          } catch (e) { return 'canvas(pixel-read-failed)'; }
        }).catch(() => '(canvas eval fail)');
        console.warn(`[capture-app] DIAGNOSTICS: title="${title}" | god~="${godSnippet}" | ${canvasStats}`);
      } catch (diagErr) {
        console.warn(`[capture-app] (diagnostics partial: ${diagErr.message})`);
      }

      if (attempt < opts.retries) {
        const backoff = 1400 * attempt;
        console.log(`[capture-app] Waiting ${backoff}ms before retry...`);
        await new Promise(r => setTimeout(r, backoff));
        // Do NOT close browser here — reuse page for next navigation attempt
      }
    }
  }

  // All retries exhausted
  await browser.close();
  console.error(`\n❌ Screenshot failed after ${opts.retries} attempts.`);
  console.error(`   Last error: ${lastError?.message || lastError}`);
  console.error(`   Tip: Run with --stable-wait --retries 5 --wait 6000 after ensuring a clean tool-managed dev server (see waitForDevServerReady guidance).`);
  throw lastError || new Error('Capture failed after retries');
}

/**
 * Waits (with polling) until the target UI region is likely rendered.
 * This is the key fix for "blank screen in Chromium" vs Firefox timing differences.
 */
async function waitForContentReady(page, target, maxMs = 8000) {
  const start = Date.now();
  const pollInterval = 280;

  const godSelectors = ['#god-mode-tools', '.god-mode-tools', '#debug-panel'];
  const canvasSelector = '#city-canvas';

  while (Date.now() - start < maxMs) {
    try {
      // Check if the specific target element exists and has size/content
      if (target === 'god-mode' || target === 'crown' || target === 'inspector') {
        for (const sel of godSelectors) {
          const el = await page.$(sel);
          if (el) {
            const box = await el.boundingBox();
            if (box && box.width > 100 && box.height > 80) {
              // Extra: make sure it has some text or children
              const text = await page.evaluate(s => {
                const n = document.querySelector(s);
                return n ? (n.textContent || '').slice(0, 120) : '';
              }, sel);
              if (text.length > 20) {
                console.log(`[capture-app] Content ready for ${target} (found ${sel})`);
                return;
              }
            }
          }
        }
      }

      // For canvas or general targets, ensure the simulation canvas is painted
      const canvas = await page.$(canvasSelector);
      if (canvas) {
        const box = await canvas.boundingBox();
        if (box && box.width > 200 && box.height > 100) {
          // Quick check: canvas not pure white/blank
          const isPainted = await page.evaluate(sel => {
            const c = document.querySelector(sel);
            if (!c) return false;
            const ctx = c.getContext('2d');
            if (!ctx) return true; // assume ok if no 2d ctx
            const data = ctx.getImageData(10, 10, 4, 4).data;
            // If mostly non-white pixels exist, it's painted
            let nonWhite = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i] < 240 || data[i+1] < 240 || data[i+2] < 240) nonWhite++;
            }
            return nonWhite > 2;
          }, canvasSelector).catch(() => true);

          if (isPainted) {
            console.log(`[capture-app] Canvas appears painted and ready`);
            return;
          }
        }
      }

      // Fallback: if body has substantial content, proceed
      const bodyTextLen = await page.evaluate(() => (document.body?.textContent || '').length).catch(() => 0);
      if (bodyTextLen > 800) {
        return;
      }
    } catch (_) {
      // ignore transient eval errors during paint
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  console.log(`[capture-app] Content wait timed out after ${maxMs}ms — proceeding with best effort (use --stable-wait or higher --wait for heavy Crown/BI renders)`);
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});