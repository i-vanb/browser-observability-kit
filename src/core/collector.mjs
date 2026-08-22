import fsp from 'node:fs/promises';
import path from 'node:path';
import { ArtifactStore, csvField } from './artifacts.mjs';
import { evaluate } from './cdp.mjs';
import { launchBrowser } from './browser.mjs';
import { hudSource } from './hud.mjs';
import { ensureExternalService, stopExternalService } from './services.mjs';
import { deepMerge, sleep, waitFor } from './utils.mjs';

export async function runCollector(options) {
  const {
    url,
    config,
    artifactRoot = path.resolve('artifacts'),
    artifactPrefix = config.artifactPrefix ?? 'browser-observability',
    sampleIntervalMs = 1000,
    smoke = false,
    smokeDurationMs = 3500,
    headless = false,
    chromeBin,
    onReady
  } = options;
  const plugins = config.plugins;
  const csvFields = [csvField('timestamp'), csvField('mark', 'local.mark'), csvField('phase', 'local.phase')];
  const seenColumns = new Set(csvFields.map((field) => field.name));
  for (const plugin of plugins) {
    for (const field of plugin.csvFields ?? []) {
      if (!seenColumns.has(field.name)) { csvFields.push(field); seenColumns.add(field.name); }
    }
  }
  csvFields.push(csvField('cdpLatencyMs'));
  const artifacts = await ArtifactStore.create({ root: artifactRoot, prefix: artifactPrefix, csvFields });
  const startedAt = new Date().toISOString();
  let browser = null;
  let service = null;
  let timer = null;
  let sampleInProgress = false;
  let stopped = false;
  let stopResolve;
  const stoppedPromise = new Promise((resolve) => { stopResolve = resolve; });
  const recordEvent = (...args) => artifacts.recordEvent(...args);
  const context = {
    options,
    config,
    artifacts,
    recordEvent,
    state: {},
    evaluate: (expression, evaluateOptions) => evaluate(browser.pageCdp, expression, evaluateOptions)
  };

  async function collectSample() {
    const started = performance.now();
    const core = await context.evaluate('window.__BROWSER_OBSERVABILITY_KIT__?.takeCoreSnapshot()');
    if (!core) throw new Error('Core HUD bootstrap is unavailable in current document');
    for (const event of core.events ?? []) recordEvent(event.type, Object.fromEntries(Object.entries(event).filter(([key]) => !['type', 'timestamp'].includes(key))), event.timestamp);
    const sample = { timestamp: new Date().toISOString(), local: { phase: core.phase, mark: core.mark }, cdpLatencyMs: null };
    const hud = {};
    for (const plugin of plugins) {
      const result = await plugin.sample?.(context, sample);
      if (result?.patch) deepMerge(sample, result.patch);
      if (result?.hud) Object.assign(hud, result.hud);
    }
    sample.cdpLatencyMs = performance.now() - started;
    await context.evaluate(`window.__BROWSER_OBSERVABILITY_KIT__?.update(${JSON.stringify({ sections: hud })})`);
    await artifacts.appendMetric(sample);
    return sample;
  }

  async function shutdown(reason = 'completed', exitCode = 0) {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    recordEvent('session-stop', { reason, exitCode });
    for (const plugin of [...plugins].reverse()) {
      try { await plugin.cleanup?.(context); } catch (error) { recordEvent('plugin-cleanup-error', { plugin: plugin.id, message: error.message }); }
    }
    try { await browser?.close(); } catch (error) { recordEvent('browser-cleanup-error', { message: error.message }); }
    try { await stopExternalService(service); } catch (error) { recordEvent('service-cleanup-error', { message: error.message }); }
    const session = {
      toolkit: 'browser-observability-kit',
      config: config.id,
      configPath: config.configPath ?? null,
      url,
      artifactDir: artifacts.directory,
      startedAt,
      stoppedAt: new Date().toISOString(),
      stopReason: reason,
      exitCode,
      samples: artifacts.metrics.length,
      events: artifacts.events.length,
      plugins: plugins.map((plugin) => plugin.id),
      externalServiceStartedByRunner: Boolean(service?.startedByRunner),
      environment: Object.assign({}, ...plugins.map((plugin) => plugin.describeEnvironment?.() ?? {}))
    };
    await artifacts.finalize({ session });
    stopResolve({ reason, exitCode, session, artifactDir: artifacts.directory });
  }

  try {
    recordEvent('session-start', { url, config: config.id, smoke });
    if (config.verifyUrl) await config.verifyUrl(url);
    service = await ensureExternalService(config.externalService, artifacts, recordEvent);
    const scripts = [hudSource(config.hud), ...plugins.flatMap((plugin) => plugin.pageScripts ?? [])];
    const domains = plugins.flatMap((plugin) => plugin.domains ?? []);
    browser = await launchBrowser({
      chromeBin, url, artifactStore: artifacts, scripts, domains, headless, recordEvent,
      beforeNavigate: async ({ browserCdp, pageCdp, port }) => {
        Object.assign(context, { browserCdp, pageCdp, cdpPort: port });
        context.evaluate = (expression, evaluateOptions) => evaluate(pageCdp, expression, evaluateOptions);
        for (const plugin of plugins) await plugin.setup?.(context);
      }
    });
    Object.assign(context, { browserCdp: browser.browserCdp, pageCdp: browser.pageCdp, cdpPort: browser.port });
    context.evaluate = (expression, evaluateOptions) => evaluate(browser.pageCdp, expression, evaluateOptions);
    await waitFor(() => context.evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('[data-browser-observability-hud]'))`), {
      timeoutMs: config.pageReadyTimeoutMs ?? 30_000,
      description: 'page and dynamic HUD'
    });
    for (const section of plugins.flatMap((plugin) => plugin.hudSections ?? [])) {
      await context.evaluate(`window.__BROWSER_OBSERVABILITY_KIT__.registerSection(${JSON.stringify(section)})`);
    }
    await sleep(1000);
    const firstSample = await collectSample();
    recordEvent('hud-ready', { url: await context.evaluate('location.href'), firstSampleTimestamp: firstSample.timestamp, hudPresent: true });
    if (smoke) {
      await context.evaluate(`window.__BROWSER_OBSERVABILITY_KIT__.mark('SMOKE')`);
      const screenshot = await browser.pageCdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await fsp.writeFile(artifacts.path('hud-smoke.png'), Buffer.from(screenshot.data, 'base64'));
    }
    timer = setInterval(() => {
      if (sampleInProgress || stopped) return;
      sampleInProgress = true;
      collectSample().catch((error) => recordEvent('sample-error', { message: error.message })).finally(() => { sampleInProgress = false; });
    }, Math.max(750, sampleIntervalMs));
    const ready = { cdpPort: browser.port, artifactDir: artifacts.directory, url, config: config.id, context, shutdown };
    onReady?.(ready);
    if (smoke) { await sleep(smokeDurationMs); await shutdown('smoke-complete', 0); }
    return { ready, stopped: stoppedPromise, shutdown };
  } catch (error) {
    recordEvent('runner-error', { message: error.message, stack: error.stack });
    await shutdown('startup-error', 1);
    throw error;
  }
}
