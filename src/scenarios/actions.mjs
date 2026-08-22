import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export function createActionHelpers(context) {
  return {
    sleep: context.sleep,
    mark: context.mark,
    evaluate: context.evaluate,
    waitFor: context.waitFor,
    async click(selector) {
      const result = await context.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLElement)) return { ok:false, reason:'selector not found' };
        element.click();
        return { ok:true };
      })()`);
      if (!result.ok) throw new Error(`Cannot click ${selector}: ${result.reason}`);
      return result;
    },
    waitForSelector(selector, options = {}) {
      return context.waitFor(() => context.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), {
        ...options,
        description: options.description ?? `selector ${selector}`
      });
    },
    waitForCondition(expression, options = {}) {
      return context.waitFor(() => context.evaluate(`Boolean(${expression})`), {
        ...options,
        description: options.description ?? 'browser condition'
      });
    },
    async httpHealth(url, { timeoutMs = 3000, expectedStatus = 200 } = {}) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
        return { ok: response.status === expectedStatus, status: response.status, url: response.url };
      } catch (error) {
        return { ok: false, status: null, url, error: error.message };
      }
    },
    runCommand(command, args = [], options = {}) {
      const stdoutPath = options.stdoutLog ? path.join(context.artifactDir, options.stdoutLog) : null;
      const stderrPath = options.stderrLog ? path.join(context.artifactDir, options.stderrLog) : null;
      const stdout = stdoutPath ? fs.openSync(stdoutPath, 'a') : 'inherit';
      const stderr = stderrPath ? fs.openSync(stderrPath, 'a') : 'inherit';
      const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: [options.stdin ?? 'ignore', stdout, stderr] });
      if (typeof stdout === 'number') fs.closeSync(stdout);
      if (typeof stderr === 'number') fs.closeSync(stderr);
      return child;
    },
    runCommandSync(command, args = [], options = {}) {
      return spawnSync(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, encoding: 'utf8', timeout: options.timeoutMs });
    },
    async stopProcess(child, { signal = 'SIGTERM', timeoutMs = 10_000 } = {}) {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      child.kill(signal);
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), context.sleep(timeoutMs)]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  };
}
