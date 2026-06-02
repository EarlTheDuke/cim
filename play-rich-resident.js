/**
 * play-rich-resident.js
 * AI (Grok) plays as one resident with goal: Get richer than the others.
 * Uses the Phase 0 hooks from agentic-residents plan.
 *
 * Usage:
 *   node play-rich-resident.js --status                 # dump my state + comparison, screenshot
 *   node play-rich-resident.js --apply '{"type":"activity","activity":"working","reason":"..."}'   # apply, advance, status, screenshot
 *   node play-rich-resident.js --init                   # force re-pick a starting resident (lowest money)
 *
 * It remembers the chosen resident in .play-rich-state.json
 * Screenshots go to screenshots/play-rich-*.png
 * Log to play-rich-log.txt
 *
 * Relies on dev server running + the window hooks (__getResidentContext, __apply..., __advanceSimHours, __sim)
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import net from 'net';
import http from 'http';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;
const STATE_FILE = '.play-rich-state.json';
const LOG_FILE = 'play-rich-log.txt';
const SCREENSHOT_DIR = 'screenshots';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.get(URL, { timeout: 2000 }, (r) => resolve(r.statusCode));
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      if (res === 200) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 800));
  }
  throw new Error('Dev server not ready');
}

async function waitForContent(page, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => {
      const god = document.querySelector('#god-mode-tools, .god-mode-tools');
      const canvas = document.querySelector('#city-canvas, canvas');
      return !!(god && canvas);
    });
    if (ready) return;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('App content not ready');
}

async function getResidentList(page) {
  return page.evaluate(() => {
    const resSys = (window).__sim?.residents || (window).sim?.residents;
    if (!resSys || !resSys.getAllResidents) return [];
    return resSys.getAllResidents().map(r => ({
      id: r.id,
      name: r.name,
      money: r.money,
      activity: r.currentActivity,
      employerId: r.employerId,
      unemployedHours: (r.unemploymentDurationTicks || 0) / 60
    }));
  });
}

async function getMyContext(page, id) {
  return page.evaluate((rid) => {
    const fn = (window).__getResidentContext || (window).__sim?.residents?.getResidentContextForAI;
    if (fn) return fn(rid);
    return null;
  }, id);
}

async function getMoneyStats(page) {
  return page.evaluate(() => {
    const resSys = (window).__sim?.residents || (window).sim?.residents;
    if (!resSys) return { myId: null, list: [] };
    const list = resSys.getAllResidents().map(r => ({ id: r.id, name: r.name, money: Math.round(r.money * 100)/100 }));
    list.sort((a,b) => b.money - a.money);
    return { list };
  });
}

async function applyDecision(page, id, decision) {
  return page.evaluate((rid, dec) => {
    const fn = (window).__applyResidentDecision || (window).__sim?.residents?.applyResidentDecision;
    if (fn) return fn(rid, dec);
    return false;
  }, id, decision);
}

async function advanceHours(page, hours) {
  return page.evaluate((h) => {
    const fn = (window).__advanceSimHours;
    if (fn) return fn(h);
    // fallback: try direct
    const s = (window).__sim;
    if (s && s.advanceSimulatedHours) { s.advanceSimulatedHours(h); return true; }
    return false;
  }, hours);
}

async function takeScreenshot(page, label) {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const file = path.join(SCREENSHOT_DIR, `play-rich-${label}-${Date.now()}.png`);
  // Focus on the main app area
  const el = await page.$('#app, .app, body');
  if (el) {
    await el.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: true });
  }
  log(`Screenshot: ${file}`);
  return file;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--status';
  const decisionArg = args.find(a => a.startsWith('{')) || args[1];

  let state = loadState();
  let myId = state.myId;

  log(`Starting play-rich-resident mode=${mode}`);

  await waitForServer();
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitForContent(page, 10000);

  // First time: pick a resident (prefer low money or unemployed for upside to get rich)
  if (!myId || mode === '--init') {
    const list = await getResidentList(page);
    if (!list.length) throw new Error('No residents');
    // Pick the one with lowest money, or first unemployed
    list.sort((a,b) => (a.money || 0) - (b.money || 0));
    const pick = list.find(r => (r.unemployedHours || 0) > 0) || list[0];
    myId = pick.id;
    state = { myId, startTime: Date.now(), turns: 0 };
    saveState(state);
    log(`Picked starting resident: ${pick.name} (${myId}) money=${pick.money} unemployedH=${pick.unemployedHours}`);
  }

  if (mode === '--status' || mode === '--init') {
    const ctx = await getMyContext(page, myId);
    const stats = await getMoneyStats(page);
    const myEntry = stats.list.find(e => e.id === myId) || { money: '??' };
    const avg = stats.list.reduce((s, e) => s + e.money, 0) / stats.list.length;
    const top = stats.list[0];
    const rank = stats.list.findIndex(e => e.id === myId) + 1;

    log(`=== STATUS TURN ${state.turns || 0} ===`);
    log(`My resident: ${myId}`);
    log(`My money: ${myEntry.money} (rank ${rank}/${stats.list.length}, avg ${avg.toFixed(1)}, top ${top.money} by ${top.name})`);
    log(`Context snapshot (key parts): needs=${JSON.stringify(ctx?.needs)}, activity=${ctx?.currentActivity}, unempH=${ctx?.unemploymentHours}, employed=${ctx?.isEmployed}`);
    if (ctx?.availableWorkplaces?.length) log(`Nearby jobs: ${ctx.availableWorkplaces.length}`);
    if (ctx?.availableHomes?.length) log(`Nearby homes: ${ctx.availableHomes.length}`);

    const shot = await takeScreenshot(page, `turn${state.turns || 0}-status`);
    log(`Status done. Screenshot: ${shot}`);
  }

  if (mode === '--apply' && decisionArg) {
    let decision;
    try { decision = JSON.parse(decisionArg); } catch (e) { throw new Error('Bad JSON decision: ' + decisionArg); }
    log(`Applying decision: ${JSON.stringify(decision)}`);

    const ok = await applyDecision(page, myId, decision);
    log(`Apply result: ${ok}`);

    // Advance a bit (1.5 sim hours = ~90 min of life, enough for needs/movement to react)
    const advanced = await advanceHours(page, 1.5);
    log(`Advanced 1.5 sim hours: ${advanced}`);

    state.turns = (state.turns || 0) + 1;
    saveState(state);

    // Re-report status
    const ctx = await getMyContext(page, myId);
    const stats = await getMoneyStats(page);
    const myEntry = stats.list.find(e => e.id === myId) || { money: '??' };
    const avg = stats.list.reduce((s, e) => s + e.money, 0) / stats.list.length;
    const top = stats.list[0];
    const rank = stats.list.findIndex(e => e.id === myId) + 1;

    log(`=== AFTER APPLY + ADVANCE (turn ${state.turns}) ===`);
    log(`My money now: ${myEntry.money} (rank ${rank}/${stats.list.length}, avg ${avg.toFixed(1)}, top ${top.money})`);
    log(`My activity: ${ctx?.currentActivity}, needs: ${JSON.stringify(ctx?.needs)}`);

    const shot = await takeScreenshot(page, `turn${state.turns}-after-apply`);
    log(`Play step complete. Screenshot: ${shot}`);
  }

  await browser.close();
  log('Play script finished.');
}

main().catch(e => {
  console.error(e);
  log('ERROR: ' + e.message);
  process.exit(1);
});