# Autonomous Screenshot System for CityWithLifeGrok

This system allows the AI (Grok) to capture screenshots of the running app at `http://localhost:5173/` **without any manual help** from you.

## Quick Usage (from PowerShell)

```powershell
# Full page
node capture-app.js

# Just the simulation canvas
node capture-app.js --target canvas --label "current-state"

# The entire God Mode panel
node capture-app.js --target god-mode --label "before-probe"

# Only the Crown Jewel / Drama section
node capture-app.js --target crown --label "crown-jewel"

# Resident Inspector
node capture-app.js --target inspector

# Custom CSS selector
node capture-app.js --selector "#city-canvas" --label "canvas-only"
```

## Available Targets

| Target       | What it captures                     | Common Use Case                     |
|--------------|--------------------------------------|-------------------------------------|
| `full`       | Entire page                          | General state                       |
| `canvas`     | Main simulation canvas               | Visual state of the city            |
| `god-mode`   | Full God Mode Tools panel            | All controls and inspectors         |
| `inspector`  | Resident Inspector                   | Resident details                    |
| `crown`      | Crown Jewel / Drama Scorecard area   | Phase 7 brain & drama features      |
| `debug`      | Basic debug panel                    | Low-level stats                     |

## From the AI's Perspective

I can now call these commands directly using my terminal tool whenever I need to see the current state of the application. This is a major step toward autonomous development and debugging.

Example commands I might run:
- `node capture-app.js --target canvas --label "after-1000x"`
- `node capture-app.js --target crown --label "before-real-grok-probe"`
- `node capture-app.js --target god-mode --label "current-ui"`

## One-Click Helpers

- `CAPTURE-APP.bat` → Basic full page capture
- You can also run the advanced commands above in PowerShell

## Notes

- The dev server (`npm run dev`) must be running.
- The script will launch a visible browser window (headless: false) so you can see what's happening if you're around.
- All screenshots are saved in the `screenshots/` folder with timestamps and labels.

This setup means you no longer need to manually take or share screenshots for me to evaluate the app. I can trigger high-quality, targeted captures as part of my normal workflow.

## Verification & Long-Running Stability Protocols (Verification Agent)

This section defines repeatable protocols for the autonomous screenshot system + terminal commands. Used by verification sub-agents and stabilization work to objectively document state, catch regressions, and validate "alive" feel during Phase A core stabilization (and beyond).

### 1. Smoke Test / Boot Health Protocol (Fast, ~2-3 min)
Run on every major change, after boot fixes, or before claiming stability.
Commands (PowerShell in project root, dev server must be up):
```
node capture-app.js --target canvas --label "smoke-boot" --wait 2500
node capture-app.js --target god-mode --label "smoke-boot" --wait 1200
node capture-app.js --target crown --label "smoke-boot" --wait 1200
node capture-app.js --target full --label "smoke-boot" --wait 1000
```
**Checklist (visual + functional via captures + manual spot-check in browser):**
- Canvas renders rich city (districts, glowing roads with BUSY/traffic indicators, dots for activity, night stars, no black dead regions or fallback text).
- God Mode panel fully loads with all sections (Time controls, Hostile Drama events buttons for blackout/port/etc, Business Snapshot with brain toggles + Live GrokBrain checkbox, Drama Scorecard with probe buttons, Crown Jewel long-run experiment buttons, persistence export/load).
- Crown/Drama area shows Phase 7 controls (A/B Grok buttons, stress probes v3, 30/60/90-day experiments, hostile+compound fuel).
- No console errors in browser devtools; app title and main UI present.
- Multiple boots produce consistent visuals (compare `smoke-boot` labeled canvases side-by-side).
- (Optional) Click a building on canvas → BusinessInspector opens with P&L/roster.

Repeat 3x for consistency. Archive screenshots with date in name for regression diffs.

### 2. Canvas Liveliness & Progression Protocol (Visual "Long Run" Feel)
For observing movement/economy/traffic over simulated time (real browser time).
- Keep a dedicated browser tab at http://localhost:5173/ open (do NOT use capture-app for progression — each capture does fresh load).
- Use manual `take-screenshot.ps1` (or double-click TAKE-SCREENSHOT.bat) every 30-60 real seconds or after advancing God Mode time jumps (+4h / Jump to specific day).
- Label files manually or rename: `liveliness-day1-10x.png`, `liveliness-evening-traffic.png`.
- What to look for (no dead spots):
  - Residents/commuters visibly moving along roads (cyan/magenta trails, animated legs).
  - Vehicles (cars/trucks) with streaks, spinning wheels, brake glows at lights, stopped counts.
  - Road occupancy changing (color shifts on BUSY segments).
  - Time-of-day cycle (dawn → work → evening → midnight with star twinkles).
  - Economy signals subtle (no stuck piles of workers, mixed home/work occupancy).
- After 5-10 real minutes of 10x-100x speed: capture God Mode + canvas again via puppeteer for "after sustained run" snapshot (compare to boot).

### 3. God Mode / Crown Jewel Feature Protocol
```
node capture-app.js --target god-mode --label "drama-probe-pre"
# (In browser or via future puppeteer automation: trigger a probe, hostile event, or "Run Crown Jewel Final Probe")
node capture-app.js --target god-mode --label "drama-probe-post"
node capture-app.js --target crown --label "crown-after-probe"
```
Verify:
- All Phase 7 buttons and toggles visible and styled (no broken layout).
- Per-business cards show brain badges (Grok vs RuleBased), decision counts/variety when brains active.
- Drama Scorecard + stress reports sections populate with rich tagged output when probes run.
- Long-run experiment buttons (30/60/90-Day) present; exports produce valid JSON with decisionLogs + hostile metadata.

### 4. Long-Running Code Invariants + Harness Validation (Complements Visual)
These are the true "100+ simulated day" checks (fast, deterministic, no browser needed):
```powershell
npm run test:run -- --reporter=dot
# Targeted heavy harness (the Phase 7 26-scenario drama trio with housing+traffic+events + real GrokBusinessBrain):
npx vitest run "src/core/SimulationValidation.test.ts" "src/systems/business/BusinessBrain.test.ts" "src/utils/simulationTestHelpers.ts" --testTimeout=120000
```
Success criteria: All 5 TE invariants (unemployment bounds, money conservation incl. business cash, no negative inventory, commute reasonableness, job-search churn) + housing + decisionLog + TL metrics hold. Rich BUNDLE reports with [HOUSING], [TRAFFIC], [EVENT], v6 Housing Drama Summary, Grok decision variety under stress.

### 5. Regression Detection Workflow
- Before change: `... --label "before-my-fix-canvas"`
- After: `... --label "after-my-fix-canvas"`
- Compare timestamps + visuals side-by-side (or use image diff tools).
- Always include `god-mode` + `crown` for UI feature regressions alongside canvas.
- Store in `screenshots/`; reference in agent handoffs (e.g. "See app-verification-post-relaunch-canvas-*.png").

### 6. Dev Server Hygiene for Captures (Critical Finding)
Hidden/background Vite (`npm run dev -- --force` via cmd) frequently drops connection after 5-15 captures (ERR_CONNECTION_REFUSED). 
Recommended for sustained verification sessions:
- Use the `start-dev-server.ps1` (right-click → Run with PowerShell) for a persistent foreground instance.
- Or keep one browser tab + use puppeteer captures sparingly + manual take-screenshot.ps1 for long visual runs.
- Re-run the aggressive kill+cache-clear+launch sequence when captures start failing.
- After any server restart: always do a `smoke-boot` sequence immediately.

### Example Full Verification Session (Terminal)
```powershell
# 1. Ensure clean server (use start-dev-server.ps1 ideally)
# 2. Smoke
node capture-app.js --target canvas --label "verify-smoke-01" --wait 2500
# ... (other targets)
# 3. Run code invariants
npm run test:run -- --reporter=basic 2>&1 | Select-String -Pattern "(Tests:|passed|failed|skipped|✓|✕)"
# 4. Let browser tab run 5+ min at 100x with time jumps; manual screenshots
# 5. Post-run snapshot captures
```

**Purpose**: Provide objective, timestamped, shareable evidence that the simulation is (or is not) stable, lively, and feature-complete. Directly supports Phase A stabilization and "test and verify everything as we go" from the Master Plan. Use before/after pairs liberally.

All protocols are designed to be run by sub-agents or the orchestrator with zero manual UI intervention beyond keeping the dev server alive.

---

## Capture Tool Hardening (Capture Tool Hardening & Reliability Agent — 2026-05-31)

### Reliability Baseline (from prior capture-reliability-01)
- 83% overall success across 18 attempts (6 cycles × god/crown/inspector).
- 100% success rate once a **stable tool-managed background dev server** was used (after aggressive kill+cache+--force launch).
- Root cause of remaining failures: dev server lifecycle (ERR_CONNECTION_REFUSED after 5-15 captures or on early boot).

### Hardening Changes in capture-app.js v2
- **Pre-flight dev server readiness**: `waitForDevServerReady()` does TCP socket polling on 5173 (configurable via `--port`) for up to ~38s before any puppeteer navigation or goto. This catches the #1 failure mode early with clear actionable guidance.
- **Lightweight content pre-check** (`quickServerContentCheck`): quick HTTP probe after port is live.
- **Smarter ECONNREFUSED handling**: explicit multi-step agent guidance in console (kill, clear .vite, background launch via tool, --stable-wait retry). No auto-launch inside script (avoids side-effects in agent environments).
- **Enhanced diagnostics on EVERY failure**:
  - `page.title()`
  - God panel text snippet (first 160 chars)
  - Canvas pixel stats (non-white count + sum from small sample)
- **--stable-wait mode** (and `--stable` alias): forces wait ≥5500ms, retries ≥5, longer content poll (12s). Ideal for long-running fleet agents doing Crown / 120d+ experiments + god/inspector pairs.
- **Tuned defaults**: wait=3200, retries=4 (up from 2500/3). All .bat helpers now pass hardened flags.
- Port is now configurable (`--port 5174` etc.) for multi-dev edge cases.
- Better logging of mode/port and improved timeout messages.

### Recommended Agent Usage (Post-Hardening)
```powershell
# Best for long-running autonomous agents / Crown work
node capture-app.js --target god-mode --label "capture-hardening-01" --stable-wait --retries 5

node capture-app.js --target crown --label "capture-hardening-02" --wait 6000 --retries 5

node capture-app.js --target inspector --label "capture-hardening-03" --stable-wait
```

### .bat / .ps1 Updates
- All CAPTURE-*.bat now default to hardened wait/retries (and --stable-wait for crown).
- start-dev-server.ps1 prints capture-friendly hint.
- TAKE-SCREENSHOT.* unchanged (manual fallback still useful).

### Best Practices (Updated from Reliability Data)
1. **Always start dev via tool-managed background** when doing >3 captures in one agent turn:
   - Kill + rm -rf node_modules\.vite .vite
   - `Start-Process ... -WindowStyle Hidden` for `npm run dev -- --force`
   - Wait 12-18s, confirm LISTENING on 5173 via Get-NetTCPConnection
   - Then call capture with --stable-wait + high wait/retries
2. Use high `--wait` (4500-6500) + `--retries 4-5` for god/crown/inspector when the UI is heavy (Crown Dashboard, BI Long-Run story, 120d+ accumulators).
3. After any dev restart, run a 3-target smoke (`canvas` + `god-mode` + `crown`) immediately.
4. On failure: read the DIAGNOSTICS line (title/God snippet/canvas pixels) — it tells you if the app is even rendering vs pure connection timing.
5. For sustained Phase C / multi-bundle work: launch one persistent dev (start-dev-server.ps1 or bg tool), then use capture sparingly + the manual take-screenshot.ps1 for in-between visual checks.
6. The poller + pre-flight now makes "first capture after clean launch" extremely reliable.

### Verification of Hardening
- Syntax / quick node check on capture-app.js (no parse/runtime errors on import/arg parse).
- 6–8+ fresh `capture-hardening-*` god/crown/inspector shots produced during this agent run (see screenshots/).
- AGENTS.md entry added.
- All changes are purely in tooling (capture-app.js + docs + helpers). Zero impact on src/ simulation or tests.

This makes the capture tool production-grade for 6–8+ agent Wave 3 / Phase C fleets. The dev server remains the only external dependency — the script now gives you the exact commands to keep it stable.

---

**End of updated CAPTURE-HELP.md**

---

## Capture Reliability Validation — Concrete Lessons & Best Practices (2026-05-31, capture-reliability-01 + 2-Hour AFK Sprint)

**Context**: During the 2-Hour AFK Sprint, a dedicated Capture Reliability Validation Agent rigorously stress-tested the hardened `capture-app.js` (retries + smart content poller) as a first-class autonomous QC gate for the fleet during sustained Phase C long-run Crown work (God 📈 Long-Run Quality dual sparks/cards + BI deep accumulator views + 300d+ multi-bundle data).

### Empirical Results
- 6 full clean capture cycles (god-mode / crown / inspector targets).
- 18 total attempts.
- **15 successful file creations** (83% overall success rate).
- **100% success rate (15/15)** on cycles using stable tool-managed background dev server after proper hygiene (C2–C6). Poller reliably hit "Content ready for god-mode/crown/inspector" on attempt 1 in virtually every stable case.
- C1 early fragility (cmd-wrapper launch issues): 0/3 (ERR_CONNECTION_REFUSED before any captures — dev died; capture-app itself not at fault).
- Per-target success: god-mode 5/6, crown 5/6, inspector 5/6.
- Delivered 15 fresh high-quality QC screenshots in `screenshots/` (e.g. `app-capture-reliability-02-cycle2-*-*.png` through cycle-6) explicitly proving the new God 📈 visuals (dual cyan/lime spark + hostile red-tinted impact card + Grok green gradient dominance split bars + compact Quality Trend spark) and BI deep "🧠 Crown Long-Run Brain Story" (narrative summary + decisionQualityTrend table + taller dual spark + red/green cards + gradient bars) live and accurate when fed rich 300d+ accumulating data under real Grok + hostile+compound drama.
- Post-validation health: tsc clean (outside pre-existing noise); targeted Crown hero + PhaseB vitest paths exercised rich reports + invariants (7 passed on hero paths | expected ultra-heavy skips).

### Recommended Production Flags & Invocation
```powershell
node capture-app.js --target god-mode --label "post-xxx" --wait 5500 --retries 5
node capture-app.js --target crown --label "post-xxx" --wait 6200 --retries 5
node capture-app.js --target inspector --label "post-xxx" --wait 5500 --retries 5
```
- Use `--wait 5500-6700` (higher than early defaults) for God/Crown/inspector panels with heavy DOM + canvas content.
- `--retries 5` is the validated sweet spot for transient timing / dev hiccups.
- Always pair with `--label` containing context (e.g. "post-probe-gridlock", "2h-afk-sprint-god-crown", "sustained-300d-qc").

### Mandatory Pre-Capture Dev Server Hygiene Pattern (Proven Reliable)
**Always** execute this sequence before every capture batch/cycle (critical Windows + Vite + puppeteer reality):

1. Aggressive kill: `Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force`
2. Clear caches: `Remove-Item -Recurse -Force node_modules\.vite -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force .vite -ErrorAction SilentlyContinue`
3. Fresh launch via **tool-managed background task** (most reliable on this Windows environment):
   - `Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev -- --force" -PassThru -WindowStyle Hidden -RedirectStandardOutput "dev-server-xxx.log" ...`
   - Or equivalent persistent wrapper (`start-dev-server.ps1` for foreground when possible).
4. Wait 12–15s for LISTENING on 5173 (check `Get-NetTCPConnection -LocalPort 5173`).
5. **Immediately** run a smoke `node capture-app.js --target god-mode --label "post-hygiene-smoke" --wait 2500 --retries 3` before the real batch.

**Tool-managed bg dev server launches were dramatically more reliable** than direct `npm run dev` in the harness for long capture sessions. Early cmd-wrapper or direct shell launches frequently caused C1-style connection deaths.

### Poller & Selector Behavior (Hardened in capture-app.js)
- Smart `waitForContentReady`: Waits for God panel text content >20 chars + non-blank canvas pixel samples (improved inspector selectors added: `#business-inspector, #inspector-mount, .business-inspector, .resident-inspector`).
- Far superior to pure fixed timeouts for dynamic Crown/God/BI panels under drama.
- Handles the Chromium (puppeteer) vs user Firefox rendering timing mismatch that caused "blank screen" artifacts in early captures.

### Known Windows / Environment Friction (Mitigated)
- **Puppeteer (Chromium) vs user Firefox timing**: Primary source of blank God/Crown screens. The hardened poller + higher wait/retries + content checks resolved it for stable dev instances.
- **Dev server lifecycle fragility**: Background Vite instances frequently drop after 5–15 captures or on process churn. Always restart with full hygiene + --force before sustained QC sessions. Tool bg wrappers are preferred.
- **Port conflicts / stale listeners**: Explicit kill on 5173/5174 + cache clear before every launch.
- **Long inspector navigation flakiness**: Documented; prefer god-mode + crown targets for Crown/Phase 7 QC; use inspector only when BI deep views are the explicit target (improved selectors help).
- **Capture-app.js now first-class gate**: Treat it exactly like harness health gates. Never claim "visuals proven" without post-hygiene + post-step captures + accompanying targeted vitest (Crown hero paths + Phase B).

### Integration with Fleet Workflows (Phase C Standard)
- Every major Crown delivery / long-run agent (sustained-longrun-crown-qc-23, 180d+ multi-bundle, etc.) **must** run full pre + post-step capture cycles (god-mode + crown + inspector) using the above hygiene + flags.
- 15+ QC screenshots from validation + fleet now serve as the visual baseline for God 📈 Long-Run Quality + BI deep accumulator story.
- Always follow capture batches with a quick targeted health gate: `npx vitest run --testTimeout=45000 "src/core/SimulationValidation.test.ts" -t "God Crown Probe Wiring|GodWiring|CROWN-JEWEL|PhaseB"`.
- Update CAPTURE-HELP.md + AGENTS.md + relevant scratch/PLANs in `temp-parallel-agent-work/` on every validation pass.
- Total autonomous screenshots now 140+ across fleet (many labeled with cycle / post-probe / qc / 2h-afk etc.).

### Quick Reference Checklist for Any Capture Session
1. Full hygiene kill + cache + fresh --force bg dev (wait for 5173 LISTENING).
2. Smoke capture (god-mode).
3. Real targeted batch with recommended --wait/--retries + descriptive labels.
4. Verify files created in screenshots/ + multimodal inspection (or direct read).
5. Targeted vitest Crown/PhaseB hero gate.
6. Log results + screenshots in agent scratch + AGENTS.md.
7. Update this section if new friction or improvements discovered.

**Outcome of Validation**: The capture system is now production-grade and reliable for autonomous Phase C long-run Crown Jewel observability QC (God dual 📈 layers + BI deep per-biz story + 📦 bundles under real Grok + 300d+ hostile+compound drama). 83% overall / 100% on properly hygienic stable dev cycles. Full best practices above are now canonical for the fleet.

Use these patterns on every future delivery. The tool + poller + hygiene combination directly enables the "visual proof" requirement for all Crown / persistence / observability work.
