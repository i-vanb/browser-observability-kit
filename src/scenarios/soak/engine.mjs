import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CDP, evaluate } from '../../core/cdp.mjs';
import { sleep, waitFor } from '../../core/utils.mjs';
import { createActionHelpers } from '../actions.mjs';

async function stopChild(child, timeoutMs = 30_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGINT');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(timeoutMs)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
}

async function connectPage(port) {
  const target = await waitFor(async () => {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    return targets.find((item) => item.type === 'page' && item.url !== 'about:blank') ?? targets.find((item) => item.type === 'page');
  }, { timeoutMs: 15_000, description: 'scenario page target' });
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  return cdp;
}

function startCollector({ projectRoot, url, configPath, artifactRoot, prefix }) {
  const cli = path.join(projectRoot, 'src/cli/run.mjs');
  const args = [cli, '--url', url, '--config', configPath, '--artifact-dir', artifactRoot, '--artifact-prefix', prefix];
  const child = spawn(process.execPath, args, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  let buffer = '';
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[collector] ${chunk}`);
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const marker = 'BROWSER_OBSERVABILITY_READY ';
      const index = line.indexOf(marker);
      if (index >= 0) {
        try { resolveReady(JSON.parse(line.slice(index + marker.length))); }
        catch (error) { rejectReady(error); }
      }
    }
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[collector stderr] ${chunk}`));
  child.once('exit', (code, signal) => {
    if (code !== 0) rejectReady(new Error(`Collector exited before ready: code=${code} signal=${signal}`));
  });
  return { child, ready };
}

export async function runSoakScenario({ projectRoot, scenario, configPath, url, durationMin, artifactRoot }) {
  if (!configPath) throw new Error('A config is required through --config or scenario.config');
  const durationMs = durationMin * 60_000;
  const profile = durationMin < 20 ? 'compressed' : 'full';
  const collector = startCollector({ projectRoot, url, configPath, artifactRoot, prefix: scenario.artifactPrefix ?? 'browser-soak' });
  let pageCdp = null;
  let artifactDir = null;
  const phases = [];
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + durationMs;
  let stopReason = 'completed';
  const context = {
    url,
    profile,
    durationMin,
    phases,
    get artifactDir() { return artifactDir; },
    sleep,
    waitFor,
    evaluate: (expression) => evaluate(pageCdp, expression, { userGesture: true }),
    mark: (label) => evaluate(pageCdp, `window.__BROWSER_OBSERVABILITY_KIT__?.mark(${JSON.stringify(label)})`, { userGesture: true })
  };
  context.actions = createActionHelpers(context);

  async function runPhase(definition) {
    const plannedMs = Number(definition.durationMs ?? 0);
    const remaining = Math.max(0, deadline - Date.now());
    if (!remaining && plannedMs > 0) {
      phases.push({ name: definition.name, status: 'skipped', reason: 'duration exhausted', plannedMs, actualMs: 0 });
      return;
    }
    const duration = Math.min(plannedMs, remaining);
    const phase = { name: definition.name, mark: definition.mark ?? definition.name, status: 'executed', startedAt: new Date().toISOString(), endedAt: null, plannedMs, actualMs: 0 };
    phases.push(phase);
    const phaseStart = Date.now();
    await context.mark(phase.mark);
    console.log(`[phase] ${phase.name} for ${(duration / 1000).toFixed(1)}s`);
    try {
      const details = await definition.action(context.actions, duration, context);
      if (details?.skipped) { phase.status = 'skipped'; phase.reason = details.reason; }
      else if (details?.failed) { phase.status = 'failed'; phase.reason = details.reason; phase.details = details.details; }
      else if (details !== undefined) phase.details = details;
    } catch (error) {
      phase.status = 'failed';
      phase.reason = error.message;
    } finally {
      const rest = duration - (Date.now() - phaseStart);
      if (definition.fillDuration !== false && rest > 0) await sleep(rest);
      phase.endedAt = new Date().toISOString();
      phase.actualMs = Date.now() - phaseStart;
    }
  }

  try {
    const ready = await Promise.race([collector.ready, sleep(90_000).then(() => { throw new Error('Timeout waiting for collector'); })]);
    artifactDir = ready.artifactDir;
    pageCdp = await connectPage(ready.cdpPort);
    await scenario.setup?.(context.actions, context);
    const definitions = typeof scenario.phases === 'function'
      ? await scenario.phases({ durationMs, durationMin, profile, actions: context.actions, context })
      : scenario.phases;
    for (const definition of definitions) {
      if (!definition?.name || typeof definition.action !== 'function') throw new Error('Each phase requires name and action');
      await runPhase(definition);
    }
  } catch (error) {
    stopReason = 'runner-error';
    console.error(error.stack ?? error.message);
  } finally {
    try { await scenario.cleanup?.(context.actions, context); } catch (error) { console.error(`Scenario cleanup failed: ${error.message}`); }
    pageCdp?.close();
    await stopChild(collector.child);
    if (artifactDir) {
      const sessionPath = path.join(artifactDir, 'session.json');
      let session = {};
      try { session = JSON.parse(await fsp.readFile(sessionPath, 'utf8')); } catch {}
      Object.assign(session, {
        scenario: scenario.id,
        scenarioPath: scenario.scenarioPath,
        soakDurationMinutesRequested: durationMin,
        soakDurationMsRequested: durationMs,
        soakStartedAt: startedAt,
        soakEndedAt: new Date().toISOString(),
        soakProfile: profile,
        phases,
        executedPhases: phases.filter((phase) => phase.status === 'executed').map((phase) => phase.name),
        skippedPhases: phases.filter((phase) => phase.status === 'skipped').map((phase) => ({ name: phase.name, reason: phase.reason })),
        failedPhases: phases.filter((phase) => phase.status === 'failed').map((phase) => ({ name: phase.name, reason: phase.reason })),
        scenarioStopReason: stopReason
      });
      await fsp.writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
      const phaseEvents = phases.map((phase) => ({ timestamp: phase.startedAt ?? phase.endedAt, type: 'phase', ...phase }));
      if (phaseEvents.length) fs.appendFileSync(path.join(artifactDir, 'events.jsonl'), `${phaseEvents.map(JSON.stringify).join('\n')}\n`);
      await scenario.finalize?.(context.actions, context);
    }
  }
  return { artifactDir, phases, stopReason };
}
