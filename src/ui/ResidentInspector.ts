/**
 * ResidentInspector
 *
 * God Mode / Resident Inspector panel for Phase 1 (Residents).
 *
 * Fully decoupled from simulation logic and main render loop.
 * - Owns and manages its own DOM subtree.
 * - Provides clean public API for selection + live refresh.
 * - Performs direct (allowed) mutations on Resident instances for god tools.
 *
 * Integration contract (see main.ts):
 *   - Mount inspector.element into the page.
 *   - Call inspector.refresh() each UI frame (cheap for 40 residents).
 *   - Wire canvas clicks → inspector.selectResident(id)
 *   - Read inspector.getSelectedResident() to highlight in viz.
 *   - Pass optional getCurrentTick for accurate per-resident commute progress display (rich "Commute" block for any resident: progress %, travel so far, est arrival, separation note — powered by MovementSystem fields on Resident).
 */

import type { ResidentsSystem } from '../systems/ResidentsSystem';
import type { LocationsSystem } from '../systems/LocationsSystem';
import type { Resident, ResidentId, Activity } from '../entities/Resident';

export class ResidentInspector {
  private readonly residentsSystem: ResidentsSystem;
  private readonly locationsSystem?: LocationsSystem;
  private readonly getCurrentTick?: () => number;
  private readonly container: HTMLDivElement;

  private selectedId: ResidentId | null = null;
  private searchTerm: string = '';

  // Small stability buffer so the Activity label doesn't flash rapidly
  // when need-overrides cause brief 'working' <-> 'at_home' chatter (very noticeable in realtime 1:1 mode).
  private lastStableActivity: string | null = null;
  private activityStableForFrames = 0;

  // DOM element references
  private searchInput!: HTMLInputElement;
  private listEl!: HTMLDivElement;
  private detailsEl!: HTMLDivElement;

  constructor(residentsSystem: ResidentsSystem, locationsSystem?: LocationsSystem, getCurrentTick?: () => number) {
    this.residentsSystem = residentsSystem;
    this.locationsSystem = locationsSystem;
    this.getCurrentTick = getCurrentTick;

    this.container = document.createElement('div');
    this.container.id = 'resident-inspector';
    this.container.className = 'resident-inspector';

    this.buildDOM();
    this.attachEventListeners();
    this.refresh();
  }

  /** The root element to mount in the DOM (e.g. inside #simulation-container) */
  get element(): HTMLDivElement {
    return this.container;
  }

  /** Currently selected resident ID (if any) */
  getSelectedId(): ResidentId | null {
    return this.selectedId;
  }

  /** Currently selected Resident instance (live reference) or null */
  getSelectedResident(): Resident | null {
    if (!this.selectedId) return null;
    return this.residentsSystem.getResident(this.selectedId) ?? null;
  }

  /**
   * Select (or deselect) a resident by ID.
   * Safe no-op if ID does not exist.
   * Triggers UI refresh.
   */
  selectResident(id: ResidentId | null): void {
    if (id !== null) {
      const exists = this.residentsSystem.getResident(id);
      if (!exists) {
        console.warn(`[ResidentInspector] Tried to select unknown resident: ${id}`);
        id = null;
      }
    }
    this.selectedId = id;
    this.refresh();
  }

  /**
   * Re-render the list (respecting current filter) and the details panel.
   * Call this from the main game loop after sim update.
   */
  refresh(): void {
    this.renderResidentList();
    this.renderDetailsPanel();
  }

  // === Private: DOM Construction ===

  private buildDOM(): void {
    // Header
    const header = document.createElement('div');
    header.className = 'inspector-header';
    header.innerHTML = `
      <h3>
        👁️ Resident Inspector
        <span class="god-badge">GOD MODE</span>
      </h3>
      <div class="inspector-subtitle">Phase 1 • 40 residents</div>
    `;
    this.container.appendChild(header);

    // Search
    const searchWrap = document.createElement('div');
    searchWrap.className = 'search-wrap';
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Filter by name, ID or activity...';
    this.searchInput.className = 'inspector-search';
    this.searchInput.setAttribute('aria-label', 'Search residents');
    searchWrap.appendChild(this.searchInput);
    this.container.appendChild(searchWrap);

    // List section
    const listLabel = document.createElement('div');
    listLabel.className = 'section-label';
    listLabel.textContent = 'All Residents';
    this.container.appendChild(listLabel);

    this.listEl = document.createElement('div');
    this.listEl.className = 'resident-list';
    this.container.appendChild(this.listEl);

    // Details section
    const detailsLabel = document.createElement('div');
    detailsLabel.className = 'section-label';
    detailsLabel.textContent = 'Selected Resident';
    this.container.appendChild(detailsLabel);

    this.detailsEl = document.createElement('div');
    this.detailsEl.className = 'inspector-details';
    this.container.appendChild(this.detailsEl);

    // Controls section
    const controlsLabel = document.createElement('div');
    controlsLabel.className = 'section-label';
    controlsLabel.textContent = 'God Mode Actions';
    this.container.appendChild(controlsLabel);

    const controls = this.buildGodModeControls();
    this.container.appendChild(controls);

    // Footer hint
    const footer = document.createElement('div');
    footer.className = 'inspector-footer';
    footer.textContent = 'Click canvas dots or list rows • ESC to deselect • Changes are live';
    this.container.appendChild(footer);
  }

  private buildGodModeControls(): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'god-controls';

    interface Action {
      label: string;
      title: string;
      action: (r: Resident) => void;
      variant?: 'danger' | 'money';
    }

    const actions: Action[] = [
      {
        label: 'Force Wake Up',
        title: 'Set activity=at_home and boost energy',
        action: (r) => {
          r.currentActivity = 'at_home';
          r.energy = Math.min(100, r.energy + 35);
        },
      },
      {
        label: '+ $100',
        title: 'Add $100 to wallet (debug)',
        action: (r) => { r.money += 100; },
        variant: 'money',
      },
      {
        label: '+ $500',
        title: 'Add $500 (quick wealth injection)',
        action: (r) => { r.money += 500; },
        variant: 'money',
      },
      {
        label: 'Teleport → Work',
        title: 'Set currentLocation = workId and activity=working',
        action: (r) => {
          r.currentLocationId = r.workId;
          r.currentActivity = 'working';
        },
      },
      {
        label: 'Teleport → Home',
        title: 'Set currentLocation = homeId and activity=at_home',
        action: (r) => {
          r.currentLocationId = r.homeId;
          r.currentActivity = 'at_home';
        },
      },
      {
        label: 'Max Energy',
        title: 'Restore energy to 100',
        action: (r) => { r.energy = 100; },
      },
      // New rich needs God actions (per-resident)
      {
        label: '🍔 Spike Hunger',
        title: 'Make this resident very hungry (test need-driven behavior)',
        action: (r) => { r.needs.hunger = Math.min(100, r.needs.hunger + 55); r.energy = Math.max(0, 100 - r.needs.fatigue); },
        variant: 'danger',
      },
      {
        label: '😴 Exhaust',
        title: 'Spike fatigue dramatically',
        action: (r) => { r.needs.fatigue = Math.min(100, r.needs.fatigue + 80); r.energy = 100 - r.needs.fatigue; },
        variant: 'danger',
      },
      {
        label: '❤️ Social Relief',
        title: 'Reduce loneliness for this person',
        action: (r) => { r.needs.social = Math.max(0, r.needs.social - 65); },
      },
      {
        label: 'Reset Needs',
        title: 'Restore comfortable baseline for this resident only',
        action: (r) => {
          r.needs.hunger = 8;
          r.needs.fatigue = 12;
          r.needs.social = 18;
          r.energy = 100 - r.needs.fatigue;
        },
      },
    ];

    actions.forEach(({ label, title, action, variant }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `god-btn ${variant ? `god-btn-${variant}` : ''}`;
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const resident = this.getSelectedResident();
        if (!resident) return;

        action(resident);

        // Re-render inspector + let main loop catch up on next frame
        this.refresh();

        // Helpful console trace for debugging god actions
        console.log(
          `%c[GodMode] ${label} → ${resident.name} (${resident.id}) | money=$${resident.money.toFixed(0)} activity=${resident.currentActivity}`,
          'color:#f472b6'
        );
      });
      wrap.appendChild(btn);
    });

    // Utility row
    const utilRow = document.createElement('div');
    utilRow.className = 'god-util-row';

    const deselectBtn = document.createElement('button');
    deselectBtn.type = 'button';
    deselectBtn.className = 'god-btn god-btn-secondary';
    deselectBtn.textContent = 'Deselect';
    deselectBtn.title = 'Clear selection (or press ESC)';
    deselectBtn.addEventListener('click', () => this.selectResident(null));
    utilRow.appendChild(deselectBtn);

    const logBtn = document.createElement('button');
    logBtn.type = 'button';
    logBtn.className = 'god-btn god-btn-secondary';
    logBtn.textContent = 'Log Full State';
    logBtn.title = 'Console.log the complete resident object';
    logBtn.addEventListener('click', () => {
      const resident = this.getSelectedResident();
      if (resident) {
        console.log('[ResidentInspector] Full resident snapshot:', {
          ...resident,
          schedule: { ...resident.schedule },
        });
      }
    });
    utilRow.appendChild(logBtn);

    wrap.appendChild(utilRow);

    return wrap;
  }

  private attachEventListeners(): void {
    // Live search filtering
    this.searchInput.addEventListener('input', () => {
      this.searchTerm = this.searchInput.value.toLowerCase().trim();
      this.renderResidentList();
    });

    // Keyboard support inside panel
    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.selectResident(null);
      }
      if (e.key.toLowerCase() === '?' && document.activeElement !== this.searchInput) {
        e.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
      }
    });

    // Make whole panel focusable for ESC
    this.container.tabIndex = -1;
  }

  // === Private: Rendering ===

  private renderResidentList(): void {
    const allResidents = this.residentsSystem.getAllResidents();
    const term = this.searchTerm;

    const filtered = term.length > 0
      ? allResidents.filter((r) =>
          r.name.toLowerCase().includes(term) ||
          r.id.toLowerCase().includes(term) ||
          r.currentActivity.toLowerCase().includes(term) ||
          r.homeId.toLowerCase().includes(term) ||
          r.workId.toLowerCase().includes(term) ||
          (r.employerId && r.employerId.toLowerCase().includes(term)) ||
          (!r.employerId && (term.includes('unemploy') || term.includes('jobless') || term === 'u'))
        )
      : allResidents;

    this.listEl.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = term ? 'No residents match filter.' : 'No residents.';
      this.listEl.appendChild(empty);
      return;
    }

    for (const resident of filtered) {
      const row = document.createElement('div');
      row.className = 'resident-row';
      if (resident.id === this.selectedId) {
        row.classList.add('selected');
      }
      row.dataset.id = resident.id;

      // Name
      const nameEl = document.createElement('span');
      nameEl.className = 'r-name';
      nameEl.textContent = resident.name;

      // Activity badge (color coded via CSS)
      const actEl = document.createElement('span');
      actEl.className = `r-activity act-${this.sanitizeActivityClass(resident.currentActivity)}`;
      actEl.textContent = resident.currentActivity.replace(/_/g, ' ');

      // Money (compact)
      const moneyEl = document.createElement('span');
      moneyEl.className = 'r-money';
      moneyEl.textContent = `$${Math.floor(resident.money)}`;

      row.appendChild(nameEl);
      row.appendChild(actEl);
      row.appendChild(moneyEl);

      // Unemployment / employment indicator (new model viz)
      const empEl = document.createElement('span');
      empEl.className = 'r-emp';
      if (resident.employerId) {
        empEl.textContent = '✓';
        empEl.title = `Employed by ${resident.employerId}`;
        empEl.style.color = '#4ade80';
      } else {
        const durTicks = (resident.unemploymentDurationTicks || 0);
        const durH = Math.round(durTicks / 60 * 10) / 10;
        empEl.textContent = durH > 0 ? `U${durH.toFixed(0)}h` : 'U';
        empEl.title = `Unemployed ${durH.toFixed(1)} hours`;
        empEl.style.color = '#fb923c';
        if (durH > 12) empEl.style.fontWeight = 'bold';
      }
      row.appendChild(empEl);

      // Click to select (also updates details)
      row.addEventListener('click', () => {
        this.selectResident(resident.id);
      });

      this.listEl.appendChild(row);
    }
  }

  private sanitizeActivityClass(activity: Activity): string {
    // Safe CSS class fragment
    return activity.replace(/[^a-z0-9_-]/gi, '');
  }

  /**
   * Returns a version of the activity that only changes after being consistent for a couple of frames.
   * Eliminates rapid "work" / "at home" flashing in the inspector during slow realtime 1:1 viewing.
   */
  private getStableActivity(raw: string): string {
    const current = raw.replace(/_/g, ' ');
    if (this.lastStableActivity === null) {
      this.lastStableActivity = current;
      this.activityStableForFrames = 2;
      return current;
    }
    if (current === this.lastStableActivity) {
      this.activityStableForFrames = Math.min(8, this.activityStableForFrames + 1);
    } else {
      this.activityStableForFrames--;
      if (this.activityStableForFrames <= 0) {
        this.lastStableActivity = current;
        this.activityStableForFrames = 2;
      }
    }
    return this.lastStableActivity;
  }

  private renderDetailsPanel(): void {
    this.detailsEl.innerHTML = '';

    const r = this.getSelectedResident();

    if (!r) {
      const placeholder = document.createElement('div');
      placeholder.className = 'no-selection';
      placeholder.innerHTML =
        'No resident selected.<br>' +
        'Click a colored dot on the canvas<br>' +
        'or a row in the list above.';
      this.detailsEl.appendChild(placeholder);
      return;
    }

    // Header with name + id
    const head = document.createElement('div');
    head.className = 'detail-head';
    head.innerHTML = `
      <div class="detail-name">${this.escapeHtml(r.name)}</div>
      <div class="detail-id">${r.id}</div>
    `;
    this.detailsEl.appendChild(head);

    // Key metrics grid
    const metrics = document.createElement('div');
    metrics.className = 'detail-metrics';

    const addMetric = (label: string, value: string, extraClass = '') => {
      const row = document.createElement('div');
      row.className = 'detail-metric' + (extraClass ? ' ' + extraClass : '');
      row.innerHTML = `
        <span class="m-label">${label}</span>
        <span class="m-value">${value}</span>
      `;
      metrics.appendChild(row);
    };

    // Use a lightly stabilized activity string for the inspector so the label doesn't flash
    // on every tick when need-driven overrides are near their thresholds (common in slow realtime viewing).
    const displayActivity = this.getStableActivity(r.currentActivity);
    addMetric('Activity', displayActivity, `act-${this.sanitizeActivityClass(r.currentActivity)}`);
    addMetric('Money', `$${r.money.toFixed(2)}`);
    addMetric('Wage', `$${r.hourlyWage}/hr`);
    addMetric('Energy', `${r.energy.toFixed(0)} / 100`);

    this.detailsEl.appendChild(metrics);

    // === NEW: Visual Needs (rich inspector upgrade) ===
    const needsVis = this.createNeedsVisual(r);
    this.detailsEl.appendChild(needsVis);

    // === Unemployment visualization + employment status (core deliverable) ===
    // Duration hints + per-resident status directly from Resident fields (synced via BusinessSystem hire/fire + job search).
    // Long-term note surfaces the behavioral effects (social creep + schedule flexibility) that job search model interacts with.
    const empBlock = document.createElement('div');
    empBlock.className = 'detail-employment';
    const durTicks = (r.unemploymentDurationTicks || 0);
    const durH = Math.round(durTicks / 60 * 10) / 10;
    const isEmp = !!r.employerId;
    empBlock.innerHTML = `
      <div class="m-label">Employment</div>
      <div class="emp-values">
        ${isEmp 
          ? `<span class="emp-status employed">✓ Employed</span> <code>${this.escapeHtml(r.employerId || '')}</code>` 
          : `<span class="emp-status unemployed">U Unemployed</span> <strong>${durH.toFixed(1)}h</strong> continuous`}
        ${!isEmp && durH > 8 ? `<span class="emp-note"> (long-term; higher social pressure + schedule flex)</span>` : ''}
      </div>
    `;
    this.detailsEl.appendChild(empBlock);

    // Schedule
    const sched = document.createElement('div');
    sched.className = 'detail-schedule';
    sched.innerHTML = `
      <div class="m-label">Daily Schedule</div>
      <div class="sched-values">
        Wake <strong>${r.schedule.wakeUpHour}:00</strong> • 
        Work <strong>${r.schedule.workStartHour}:00–${r.schedule.workEndHour}:00</strong> • 
        Sleep <strong>${r.schedule.sleepHour}:00</strong>
      </div>
    `;
    this.detailsEl.appendChild(sched);

    // === ENHANCED: Locations with positions when LocationsSystem available ===
    const loc = document.createElement('div');
    loc.className = 'detail-locations';
    const homePos = this.getLocationPositionString(r.homeId);
    const workPos = this.getLocationPositionString(r.workId);
    const currPos = this.getLocationPositionString(r.currentLocationId);
    loc.innerHTML = `
      <div class="m-label">Locations</div>
      <div class="loc-values">
        <span>Home: <code>${this.escapeHtml(r.homeId)}</code>${homePos ? ` <span class="pos">(${homePos})</span>` : ''}</span><br>
        <span>Work: <code>${this.escapeHtml(r.workId)}</code>${workPos ? ` <span class="pos">(${workPos})</span>` : ''}</span><br>
        <span>Current: <code>${this.escapeHtml(r.currentLocationId)}</code>${currPos ? ` <span class="pos">(${currPos})</span>` : ''}</span>
      </div>
    `;
    this.detailsEl.appendChild(loc);

    // === Rich Commute details block (Agent MT): progress %, travel time so far, est. arrival, note on traffic separation ===
    // Uses Resident's public MovementSystem-powered accessors (getCommute*, commuteTargetId) + getCurrentTick.
    // Always renders a "Commute" section so ANY selected resident shows believable current commute state.
    // "current road/vehicle": N/A for residents (MovementSystem does direct timed interpolation; TrafficSystem is independent viz layer).
    const commuteBlock = document.createElement('div');
    commuteBlock.className = 'detail-commute detail-employment'; // reuse styling hook
    const tick = typeof this.getCurrentTick === 'function' ? this.getCurrentTick() : 0;

    if (r.commuteTargetId) {
      const progress = r.getCommuteProgressAt(tick);
      const pct = (progress * 100).toFixed(0);
      const dur = r.getCommuteDurationTicks() || 0;
      const elapsed = Math.max(0, Math.round(progress * dur));
      const remain = Math.max(0, dur - elapsed);
      const elapsedH = (elapsed / 60).toFixed(1);
      const remainH = (remain / 60).toFixed(1);

      commuteBlock.innerHTML = `
        <div class="m-label">🚶 Commute (MovementSystem)</div>
        <div class="emp-values">
          Target: <code>${this.escapeHtml(r.commuteTargetId)}</code><br>
          Progress: <strong>${pct}%</strong> <span style="opacity:0.8;">(elapsed ~${elapsed}t / ${dur}t • ~${remain}t remain)</span><br>
          Travel time so far: ~${elapsed}t (~${elapsedH}h)<br>
          Est. arrival: in ~${remain}t (~${remainH}h) — at tick ~${tick + remain}
        </div>
        <div style="font-size:0.65rem; color:#64748b; margin-top:2px;">
          No personal road/vehicle assigned (MovementSystem drives resident position directly). Traffic cars/trucks are separate decorative + congestion flows (see God Mode charts).
        </div>
      `;
    } else {
      commuteBlock.innerHTML = `
        <div class="m-label">🚶 Commute (MovementSystem)</div>
        <div class="emp-values">
          <span class="emp-status employed">At destination</span> (snapped to home or work)
        </div>
        <div style="font-size:0.65rem; color:#64748b; margin-top:2px;">
          Not currently commuting. Next schedule-driven transit will create fresh timed commute (progress, duration, arrival visible here when active). Consistent with live chart series.
        </div>
      `;
    }
    this.detailsEl.appendChild(commuteBlock);

    // === AI / Agentic visibility (Priority 3): surface jobHuntTarget, preferredHomeTarget, conserve, brain, decisionLog when present ===
    // Badges + list make "agents at work / climbing" immediately obvious when inspecting a controlled resident.
    // Ties directly to ResidentsSystem.getAIControlledResidents + Resident public fields/getters + getResidentDecisionLog.
    // Realism comment: these voluntary choices (target a better job for wage upside, move home on rent signal, conserve after earnings) are what let AI residents reach the top without central planning.
    const aiBlock = document.createElement('div');
    aiBlock.className = 'detail-ai detail-employment'; // reuse styling
    const hasBrain = !!r.getBrain?.();
    const hasJobTarget = !!r.jobHuntTargetId;
    const hasHomeTarget = !!r.preferredHomeTargetId;
    const conserving = !!r.conserveUntilTick && (typeof (r as any).conserveUntilTick === 'number');
    const decLog: any[] = (typeof r.getResidentDecisionLog === 'function') ? r.getResidentDecisionLog() : [];
    const isTagged = !!(r as any).__isGrokAgent;
    if (hasBrain || hasJobTarget || hasHomeTarget || conserving || decLog.length > 0 || isTagged) {
      let aiHtml = `<div class="m-label">🧠 AI Agent Controls (voluntary decisions)</div><div class="emp-values">`;
      // Hoisted so both the brain-summary block and the recent-decisions block below can reference them.
      const brainInst = r.getBrain?.();
      const isGrokB = !!brainInst && (brainInst.name?.includes('Grok') || (brainInst.lastProviderName && /Grok|Provider/i.test(brainInst.lastProviderName)));
      const prov = brainInst?.lastProviderName || (isGrokB ? 'GrokResidentBrain (provider)' : null);
      if (isTagged || hasBrain) {
        let bName = brainInst?.name || ((r as any).__isGrokAgent ? 'GrokAgent' : 'AI');
        const provTag = prov ? (/GrokXAI|Provider/i.test(String(prov)) ? `Grok-xAI (real: ${prov})` : `provider:${prov}`) : (isGrokB ? 'stub' : null);
        if (isGrokB) bName = `🧠 BRAIN (lastProviderName: ${provTag || prov || 'stub'})`;
        aiHtml += `<span class="emp-status employed">🧠 ${this.escapeHtml(bName)}</span> `;
        if (isGrokB) {
          // Surface last decision signals (dailyEarningsPotential, marketRent/pressure, margins, timeToNext, drama) + reason from log if present
          const dlog = (typeof r.getResidentDecisionLog === 'function') ? r.getResidentDecisionLog() : [];
          const lastD = dlog.length ? (dlog[dlog.length-1].decision || dlog[dlog.length-1]) : null;
          const int = lastD?.intensity != null ? ` int${Number(lastD.intensity).toFixed(2)}` : '';
          const c: any = (lastD as any)?.ctx || (r as any).__lastDecisionCtx || {};
          const sigs = [c.dailyEarningsPotential!=null?`dailyP=${c.dailyEarningsPotential}`:'', (c.marketRent||c.pressure)!=null?`rent/pressure=${c.marketRent||c.pressure}`:'', c.timeToNextPaydayHours!=null?`tNext=${c.timeToNextPaydayHours}`:''].filter(Boolean).join(' ');
          const rsn = (lastD?.reason || '').toString().slice(0,42);
          aiHtml += `<span style="font-size:0.82em;color:#f0abfc;">${int} ${sigs} ${rsn?`“${this.escapeHtml(rsn)}...”`:''} (brain via provider chose high-value using dailyPotential + margins)</span><br>`;
        }
      }
      if (hasJobTarget) {
        aiHtml += `<span style="background:#1e40af;color:#bae6fd;padding:0 3px;border-radius:2px;">🎯 AI-TARGETING: <code>${this.escapeHtml(String(r.jobHuntTargetId).slice(0,10))}</code> (est higher wage / better job via free market choice)</span><br>`;
      }
      if (hasHomeTarget) {
        aiHtml += `<span style="background:#166534;color:#a3e635;padding:0 3px;border-radius:2px;">🏠 AI-HOME: <code>${this.escapeHtml(String(r.preferredHomeTargetId).slice(0,10))}</code> (lower rent pressure signal)</span><br>`;
      }
      if (conserving) {
        const until = r.conserveUntilTick;
        aiHtml += `<span style="background:#334155;color:#67e8f9;padding:0 3px;border-radius:2px;">🛡️ CONSERVING spend 0.2x until tick ~${until}</span><br>`;
      }
      if (decLog.length) {
        aiHtml += `<div style="margin-top:2px;font-size:0.92em;opacity:0.95;">Recent decisions (${decLog.length}):<ul style="margin:1px 0 0 12px;padding:0;list-style:none;">`;
        decLog.slice(-4).reverse().forEach((entry: any) => {
          const d = entry.decision || entry;
          const rawReason = String(d.reason || d.decision?.reason || '').slice(0, 64);
          const reason = this.escapeHtml(rawReason);
          const type = d.type || 'decision';
          const isRealProv = prov && /GrokXAI|Provider/i.test(String(prov));
          const tag = isGrokB ? (isRealProv ? ' [Grok-xAI (real)]' : ' [stub]') : '';
          aiHtml += `<li>• ${type}${tag}: ${reason || '(no reason)'}</li>`;
        });
        aiHtml += `</ul></div>`;
      }
      aiHtml += `</div><div style="font-size:0.58rem;color:#64748b;margin-top:1px;">Agentic state from public Resident + ResidentsSystem. See God "👤 AI Citizens" for Top 5 + live list.</div>`;
      aiBlock.innerHTML = aiHtml;
      this.detailsEl.appendChild(aiBlock);
    }

    // Tiny live hint
    const hint = document.createElement('div');
    hint.className = 'detail-hint';
    hint.textContent = 'State is live — god actions apply instantly. Needs bars update every tick.';
    this.detailsEl.appendChild(hint);
  }

  /** Helper: resolve position string from LocationsSystem (or empty) */
  private getLocationPositionString(locId: string): string {
    if (!this.locationsSystem) return '';
    const loc = this.locationsSystem.getLocation(locId as any);
    if (!loc || !loc.position) return '';
    const p = loc.position;
    return `${p.x.toFixed(0)}, ${p.y.toFixed(0)}`;
  }

  /** Create rich visual needs progress bars for the selected resident */
  private createNeedsVisual(r: Resident): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'detail-needs';

    const label = document.createElement('div');
    label.className = 'm-label';
    label.textContent = 'Needs (visual)';
    wrap.appendChild(label);

    const makeBar = (name: string, value: number, color: string) => {
      const row = document.createElement('div');
      row.className = 'need-bar-row';

      const nm = document.createElement('span');
      nm.className = 'need-name';
      nm.textContent = name;

      const track = document.createElement('div');
      track.className = 'need-track';

      const fill = document.createElement('div');
      fill.className = 'need-fill';
      fill.style.width = `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;
      fill.style.background = color;

      if (value > 75) fill.classList.add('critical');
      else if (value > 50) fill.classList.add('high');

      track.appendChild(fill);

      const num = document.createElement('span');
      num.className = 'need-num';
      num.textContent = Math.round(value).toString();

      row.appendChild(nm);
      row.appendChild(track);
      row.appendChild(num);
      return row;
    };

    wrap.appendChild(makeBar('Hunger', r.needs.hunger, '#f87171'));
    wrap.appendChild(makeBar('Fatigue', r.needs.fatigue, '#fbbf24'));
    wrap.appendChild(makeBar('Social', r.needs.social, '#a78bfa'));

    return wrap;
  }

  private escapeHtml(str: string): string {
    // Minimal escaping for the data we control
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
