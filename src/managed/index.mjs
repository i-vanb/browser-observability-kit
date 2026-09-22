import { installResponsivenessProbe } from '../browser/probes.mjs';
import { launchBrowser } from '../core/browser.mjs';
import { evaluate } from '../core/cdp.mjs';
import { ChromeProcessSampler, detectPhysicalGpuTelemetry } from '../core/process-metrics.mjs';
import { sleep, waitFor } from '../core/utils.mjs';

const DEFAULT_SAMPLE_INTERVAL_MS = 1000;
const MIN_SAMPLE_INTERVAL_MS = 750;
const MB = 1024 * 1024;

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bytesToMb(value) {
  const number = finiteOrNull(value);
  return number === null ? null : number / MB;
}

function metricMap(metrics) {
  return Object.fromEntries((metrics.metrics ?? []).map((entry) => [entry.name, entry.value]));
}

function normalizeUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Managed observer URL must use http or https');
  }
  url.hash = '';
  return url;
}

function isAllowedRequest(value, allowedOrigins) {
  try {
    const url = new URL(value);
    if (['data:', 'blob:'].includes(url.protocol)) return true;
    return ['http:', 'https:'].includes(url.protocol) && allowedOrigins.has(url.origin);
  } catch {
    return false;
  }
}

function physicalGpuCapability(provider) {
  return {
    available: provider.available,
    provider: provider.provider,
    reason: provider.reason ?? null,
    adapters: provider.adapters
  };
}

export function createManagedObserver({
  url,
  chromeBin,
  sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
  readyExpression = 'document.readyState === "complete"',
  pageReadyTimeoutMs = 30_000,
  allowedOrigins,
  onDiagnostic = () => {}
} = {}) {
  const targetUrl = normalizeUrl(url);
  const origins = new Set((allowedOrigins ?? [targetUrl.origin]).map((value) => new URL(value).origin));
  if (!origins.has(targetUrl.origin)) {
    throw new TypeError('allowedOrigins must include the managed target origin');
  }
  const intervalMs = Math.max(MIN_SAMPLE_INTERVAL_MS, Number(sampleIntervalMs) || DEFAULT_SAMPLE_INTERVAL_MS);
  const subscribers = new Set();
  const processSampler = new ChromeProcessSampler();
  const physicalGpu = detectPhysicalGpuTelemetry();
  let browser = null;
  let timer = null;
  let latest = null;
  let started = false;
  let destroyed = false;
  let sampleInProgress = false;

  const diagnostic = (type, detail = {}) => {
    try { onDiagnostic({ type, detail, timestamp: Date.now() }); } catch {}
  };

  async function collect({ notify = true } = {}) {
    if (!started || !browser) throw new Error('Start the managed observer before taking a snapshot');
    const [processes, responsiveness, performanceMetrics, dom] = await Promise.all([
      processSampler.sample(browser.browserCdp),
      evaluate(browser.pageCdp, 'window.__BOK_BROWSER_PERFORMANCE__?.snapshot() ?? null'),
      browser.pageCdp.send('Performance.getMetrics'),
      browser.pageCdp.send('Memory.getDOMCounters')
    ]);
    const metrics = metricMap(performanceMetrics);
    const physical = physicalGpu.sample();
    latest = {
      timestamp: Date.now(),
      processes,
      responsiveness: responsiveness ?? {
        eventLoopLagMs: null,
        longTasksSupported: false,
        longTasks10s: null,
        maxLongTaskMs10s: null
      },
      page: {
        heapUsedMb: bytesToMb(metrics.JSHeapUsedSize),
        heapTotalMb: bytesToMb(metrics.JSHeapTotalSize),
        documents: finiteOrNull(dom.documents),
        nodes: finiteOrNull(dom.nodes),
        listeners: finiteOrNull(dom.jsEventListeners)
      },
      physicalGpu: physical.available
        ? {
            available: true,
            provider: physical.provider,
            gpuUtil: finiteOrNull(physical.gpuUtil),
            videoDecodeUtil: finiteOrNull(physical.videoDecodeUtil),
            memoryUsedMb: finiteOrNull(physical.memoryUsedMb),
            memoryTotalMb: finiteOrNull(physical.memoryTotalMb)
          }
        : {
            available: false,
            provider: physical.provider ?? null,
            reason: physical.error ?? physicalGpu.reason ?? 'Physical GPU telemetry is unavailable'
          }
    };
    if (notify) {
      for (const subscriber of subscribers) {
        try { subscriber(latest); } catch (error) { diagnostic('subscriber-error', { message: error.message }); }
      }
    }
    return latest;
  }

  const api = {
    async start() {
      if (destroyed) throw new Error('Cannot restart a destroyed managed observer');
      if (started) return api;
      try {
        browser = await launchBrowser({
          chromeBin,
          url: targetUrl.href,
          headless: true,
          sandbox: true,
          domains: ['Memory', 'Fetch'],
          scripts: [`(${installResponsivenessProbe.toString()})()`],
          extraArgs: [
            '--disable-background-networking',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-sync',
            '--disable-features=MediaRouter,Translate',
            '--no-pings'
          ],
          recordEvent: diagnostic,
          beforeNavigate: async ({ browserCdp, pageCdp }) => {
            await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
            pageCdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
              if (isAllowedRequest(request.url, origins)) {
                await pageCdp.send('Fetch.continueRequest', { requestId });
              } else {
                diagnostic('request-blocked', { origin: (() => {
                  try { return new URL(request.url).origin; } catch { return 'invalid'; }
                })() });
                await pageCdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
              }
            });
            pageCdp.on('Page.frameNavigated', ({ frame }) => {
              if (frame.parentId || frame.url === 'about:blank') return;
              try {
                const navigated = normalizeUrl(frame.url);
                if (navigated.href === targetUrl.href) return;
                diagnostic('unexpected-navigation', { origin: navigated.origin, path: navigated.pathname });
              } catch {
                diagnostic('unexpected-navigation', { origin: 'invalid', path: null });
              }
              void api.destroy();
            });
          }
        });
        await waitFor(() => evaluate(browser.pageCdp, readyExpression), {
          timeoutMs: pageReadyTimeoutMs,
          description: 'managed workload page'
        });
        started = true;
        await processSampler.sample(browser.browserCdp);
        await sleep(250);
        await collect();
        timer = setInterval(() => {
          if (sampleInProgress || destroyed) return;
          sampleInProgress = true;
          collect().catch((error) => diagnostic('sample-error', { message: error.message })).finally(() => {
            sampleInProgress = false;
          });
        }, intervalMs);
        return api;
      } catch (error) {
        await api.destroy();
        throw error;
      }
    },
    snapshot() {
      return collect({ notify: false });
    },
    subscribe(subscriber) {
      if (typeof subscriber !== 'function') throw new TypeError('subscribe() requires a function');
      subscribers.add(subscriber);
      if (latest) subscriber(latest);
      return () => subscribers.delete(subscriber);
    },
    evaluate(expression) {
      if (!started || !browser) throw new Error('Managed observer is not running');
      return evaluate(browser.pageCdp, expression);
    },
    environment() {
      return {
        browser: browser?.version?.Browser ?? null,
        chromeSandbox: browser?.sandbox === true,
        targetOrigin: targetUrl.origin,
        physicalGpu: physicalGpuCapability(physicalGpu)
      };
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      subscribers.clear();
      if (browser) {
        try { await evaluate(browser.pageCdp, 'window.__BOK_BROWSER_PERFORMANCE__?.destroy()'); } catch {}
        await browser.close();
      }
      browser = null;
      started = false;
    }
  };

  return api;
}
