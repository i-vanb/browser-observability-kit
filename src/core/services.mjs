import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { sleep, waitFor } from './utils.mjs';

async function fetchOk(url, timeoutMs = 3000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    return response.ok;
  } catch { return false; }
}

export async function ensureExternalService(config, artifacts, recordEvent) {
  if (!config) return { config: null, startedByRunner: false, alreadyRunning: false, child: null };
  if (await fetchOk(config.healthUrl)) return { config, startedByRunner: false, alreadyRunning: true, child: null };
  const stdoutFd = artifacts.openLog(config.stdoutLog ?? 'service.log');
  const stderrFd = artifacts.openLog(config.stderrLog ?? 'service.stderr.log');
  const [command, ...args] = config.startCommand;
  const child = spawn(command, args, { stdio: ['ignore', stdoutFd, stderrFd], env: process.env });
  child.once('exit', (code, signal) => recordEvent('external-service-exit', { id: config.id, code, signal }));
  await waitFor(() => fetchOk(config.healthUrl), {
    timeoutMs: config.startupTimeoutMs ?? 30_000,
    intervalMs: 500,
    description: `${config.id} health`
  });
  return { config, startedByRunner: true, alreadyRunning: false, child, stdoutFd, stderrFd };
}

export async function stopExternalService(service) {
  if (!service?.startedByRunner) return;
  const config = service.config;
  if (config.stopCommand) {
    const [command, ...args] = config.stopCommand;
    spawnSync(command, args, { encoding: 'utf8' });
  }
  const child = service.child;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(10_000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  try { fs.closeSync(service.stdoutFd); } catch {}
  try { fs.closeSync(service.stderrFd); } catch {}
}

export { fetchOk };
