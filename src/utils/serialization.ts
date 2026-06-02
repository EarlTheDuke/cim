/**
 * Serialization helpers
 * 
 * These will become much more important as the simulation grows.
 * For now they provide a clean foundation.
 */

export interface Serializable {
  toJSON(): any;
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** Safely stringify with better error handling */
export function safeStringify(obj: any, space?: number): string {
  try {
    return JSON.stringify(obj, null, space);
  } catch (err) {
    console.error('Serialization failed:', err);
    return '{"error": "Serialization failed"}';
  }
}

/** Safely parse JSON */
export function safeParse<T = any>(json: string): T | null {
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error('Deserialization failed:', err);
    return null;
  }
}

// === Scenario / Persistence robustness helpers (Agent PS) ===

export interface ScenarioInfo {
  valid: boolean;
  name?: string;
  exportedAt?: string;
  version?: number;
  residentCount?: number;
  timeHours?: number;
  locationCount?: number;
  hasBusinessData?: boolean;
  hasEconomyData?: boolean;
  hasTrafficData?: boolean;
  error?: string;
  /** Human friendly one-line summary for UI */
  summary?: string;
}

/**
 * Analyze a scenario JSON string for validity, extract key metadata for preview/validation feedback.
 * Robust to missing fields; never throws. Pure helper, no side effects.
 */
export function analyzeScenarioJSON(json: string): ScenarioInfo {
  if (!json || typeof json !== 'string' || json.trim().length === 0) {
    return { valid: false, error: 'Empty input', summary: 'No JSON provided' };
  }

  const data = safeParse<any>(json);
  if (!data) {
    return { valid: false, error: 'Invalid JSON syntax (parse failed)', summary: 'Malformed JSON' };
  }

  try {
    const info: ScenarioInfo = {
      valid: true,
      version: typeof data.version === 'number' ? data.version : undefined,
      name: data.scenarioName || data.meta?.scenarioName,
      exportedAt: data.scenarioExportedAt || data.meta?.savedAtRealTime ? new Date(data.meta.savedAtRealTime).toISOString() : undefined,
      residentCount: Array.isArray(data.residents) ? data.residents.length : (data.meta?.residentCount ?? undefined),
      timeHours: data.time?.timeHours ?? data.time?.hours,
      locationCount: Array.isArray(data.locations) ? data.locations.length : (data.meta?.locationCount ?? undefined),
      hasBusinessData: !!(data.businesses || data.businessSnapshot || data.meta?.businessCount),
      hasEconomyData: !!(data.economy || data.economySnapshot || data.meta?.gdp),
      hasTrafficData: !!(data.traffic || data.trafficSnapshot || data.meta?.vehicleCount),
    };

    const namePart = info.name ? `"${info.name}"` : 'unnamed';
    const popPart = info.residentCount != null ? `${info.residentCount} residents` : 'unknown pop';
    const timePart = info.timeHours != null ? ` @ ${info.timeHours.toFixed(1)}h` : '';
    info.summary = `${namePart} — ${popPart}${timePart}${info.valid ? '' : ' (issues)'}`;

    return info;
  } catch (e) {
    return {
      valid: false,
      error: `Analysis error: ${(e as Error)?.message || e}`,
      summary: 'Could not extract scenario metadata',
    };
  }
}
