import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CDP } from './cdp.mjs';
import { sleep, waitFor } from './utils.mjs';

async function stopChild(child, timeoutMs = 8000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(timeoutMs)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(3000)]);
  }
}

export async function launchBrowser({
  chromeBin = process.env.CHROME_BIN ?? '/usr/bin/google-chrome',
  url,
  artifactStore,
  scripts = [],
  domains = [],
  headless = false,
  sandbox = false,
  extraArgs = [],
  ozonePlatform = process.env.BROWSER_OBSERVABILITY_OZONE,
  recordEvent = () => {},
  beforeNavigate
}) {
  const profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'browser-observability-kit-'));
  const stdoutFd = artifactStore?.openLog('chrome-stdout.log') ?? null;
  const stderrFd = artifactStore?.openLog('chrome-stderr.log') ?? null;
  let stderrTail = '';
  const args = [
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`, '--window-size=1280,1000', '--new-window', 'about:blank'
  ];
  if (!sandbox) args.unshift('--no-sandbox');
  if (headless) args.unshift('--headless=new');
  if (ozonePlatform) args.unshift(`--ozone-platform=${ozonePlatform}`);
  args.unshift(...extraArgs);
  const child = spawn(chromeBin, args, {
    stdio: ['ignore', stdoutFd ?? 'ignore', stderrFd ?? 'pipe'],
    env: process.env
  });
  child.stderr?.on('data', (chunk) => {
    stderrTail = (stderrTail + String(chunk)).slice(-8_000);
  });
  child.once('exit', (code, signal) => recordEvent('chrome-exit', { code, signal }));
  let browserCdp = null;
  let pageCdp = null;
  try {
    const devToolsFile = path.join(profileDir, 'DevToolsActivePort');
    const [port] = await waitFor(async () => {
      try {
        const lines = (await fsp.readFile(devToolsFile, 'utf8')).trim().split('\n');
        return lines.length >= 2 ? lines : null;
      } catch { return null; }
    }, { timeoutMs: 20_000, description: 'Chrome DevToolsActivePort' });

    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
    const onHandlerError = (method, error) => recordEvent('diagnostic-handler-error', { method, message: error.message });
    browserCdp = new CDP(version.webSocketDebuggerUrl, onHandlerError);
    await browserCdp.connect();
    const page = await waitFor(async () => {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      return targets.find((target) => target.type === 'page');
    }, { timeoutMs: 10_000, description: 'Chrome page target' });
    pageCdp = new CDP(page.webSocketDebuggerUrl, onHandlerError);
    await pageCdp.connect();
    await Promise.all([...new Set(['Page', 'Runtime', 'Network', 'Performance', ...domains])].map((domain) => pageCdp.send(`${domain}.enable`).catch((error) => {
      recordEvent('cdp-domain-unavailable', { domain, message: error.message });
    })));
    for (const source of scripts) await pageCdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
    await beforeNavigate?.({ browserCdp, pageCdp, port: Number(port) });
    await pageCdp.send('Page.navigate', { url });

    return {
      child,
      profileDir,
      port: Number(port),
      version,
      sandbox,
      browserCdp,
      pageCdp,
      async close() {
        try { await browserCdp.send('Browser.close'); } catch {}
        await stopChild(child);
        pageCdp.close();
        browserCdp.close();
        if (stdoutFd !== null) fs.closeSync(stdoutFd);
        if (stderrFd !== null) fs.closeSync(stderrFd);
        if (profileDir.startsWith(path.join(os.tmpdir(), 'browser-observability-kit-'))) {
          await fsp.rm(profileDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    };
  } catch (error) {
    pageCdp?.close();
    browserCdp?.close();
    await stopChild(child);
    if (stdoutFd !== null) fs.closeSync(stdoutFd);
    if (stderrFd !== null) fs.closeSync(stderrFd);
    if (profileDir.startsWith(path.join(os.tmpdir(), 'browser-observability-kit-'))) {
      await fsp.rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
    const stderr = stderrTail.trim();
    throw new Error(`${error.message}${stderr ? `; Chrome stderr: ${stderr}` : ''}`, { cause: error });
  }
}
