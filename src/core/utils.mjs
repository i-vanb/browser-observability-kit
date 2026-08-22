import { spawnSync } from 'node:child_process';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(check, { timeoutMs = 30_000, intervalMs = 250, description = 'condition', signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Timeout waiting for ${description}${lastError ? `; last error: ${lastError.message}` : ''}`);
}

export function findExecutable(name) {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const equal = value.indexOf('=');
    if (equal > 0) {
      options[value.slice(2, equal)] = value.slice(equal + 1);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index++;
    } else {
      options[key] = true;
    }
  }
  return options;
}

export function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

export function getPath(value, path) {
  return path.split('.').reduce((current, part) => current?.[part], value);
}

export function asNumber(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive number, received: ${value}`);
  return parsed;
}
