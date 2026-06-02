#!/usr/bin/env node
/**
 * verify-simulation.js
 * Autonomous Verification Protocol Runner for CityWithLifeGrok
 *
 * Runs a standard smoke + UI health capture sequence using the capture-app.js system.
 * Use for boot health, regression detection, and supporting stabilization agents.
 *
 * Usage:
 *   node verify-simulation.js                 # default smoke protocol
 *   node verify-simulation.js --full          # include full page + inspector
 *   node verify-simulation.js --label "pre-stabilization"
 *
 * Requires: dev server running at http://localhost:5173/
 * Outputs: timestamped screenshots in screenshots/ + console summary
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const options = {
  label: 'verify',
  full: args.includes('--full') || args.includes('-f'),
};

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--label' || args[i] === '-l') && args[i + 1]) {
    options.label = args[++i];
  }
}

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runLabel = `${options.label}-${timestamp}`;

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   CityWithLifeGrok — Autonomous Verification Protocol      ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log(`Run label : ${runLabel}`);
console.log(`Mode      : ${options.full ? 'FULL (canvas + god + crown + full + inspector)' : 'STANDARD (canvas + god + crown)'}`);
console.log('Dev server: http://localhost:5173/ (must be running)');
console.log('');

const targets = [
  { target: 'canvas', wait: 2500 },
  { target: 'god-mode', wait: 1200 },
  { target: 'crown', wait: 1200 },
];

if (options.full) {
  targets.push({ target: 'full', wait: 1000 });
  targets.push({ target: 'inspector', wait: 1000 });
}

const results = [];

function runCapture(target, wait) {
  const cmd = `node capture-app.js --target ${target} --label "${runLabel}" --wait ${wait}`;
  console.log(`\n▶ [${target.toUpperCase()}] ${cmd}`);
  try {
    const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: 90000 });
    console.log(output.trim());
    results.push({ target, status: 'SUCCESS' });
    return true;
  } catch (err) {
    console.error(`❌ Capture failed for ${target}: ${err.message.split('\n')[0]}`);
    results.push({ target, status: 'FAILED', error: err.message.split('\n')[0] });
    return false;
  }
}

console.log('=== Starting capture sequence ===');
let successCount = 0;

for (const { target, wait } of targets) {
  if (runCapture(target, wait)) successCount++;
  // Small pause between captures to reduce load on server
  if (targets.indexOf({ target, wait }) < targets.length - 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
}

console.log('\n=== Verification Protocol Summary ===');
console.log(`Completed: ${successCount}/${targets.length} captures`);
results.forEach(r => {
  const icon = r.status === 'SUCCESS' ? '✅' : '❌';
  console.log(`  ${icon} ${r.target.padEnd(10)} ${r.status}${r.error ? ' — ' + r.error : ''}`);
});

if (successCount === targets.length) {
  console.log('\n✅ ALL CAPTURES SUCCEEDED — Boot + UI health looks good.');
  console.log('   Review latest screenshots/ for visual inspection (canvas liveliness, God Mode completeness).');
  console.log('   Next: run `npm run test:run` (or targeted harness) for code-level long-run invariants.');
} else {
  console.log('\n⚠️  SOME CAPTURES FAILED — Check dev server (relaunch with start-dev-server.ps1 recommended).');
  console.log('   Common: hidden Vite drops connection; use foreground dev server for long sessions.');
}

console.log('\nProtocol files (recent):');
try {
  const recent = fs.readdirSync(SCREENSHOTS_DIR)
    .filter(f => f.includes(runLabel) || f.includes(options.label))
    .sort()
    .slice(-6);
  recent.forEach(f => console.log(`  screenshots/${f}`));
} catch (e) {
  // ignore
}

console.log('\nSee CAPTURE-HELP.md → "Verification & Long-Running Stability Protocols" for full checklists.');
console.log('════════════════════════════════════════════════════════════');

process.exit(successCount === targets.length ? 0 : 1);