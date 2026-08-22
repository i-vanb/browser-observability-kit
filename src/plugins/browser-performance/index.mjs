import { csvField } from '../../core/artifacts.mjs';
import { ChromeProcessSampler, detectPhysicalGpuTelemetry } from '../../core/process-metrics.mjs';

function pageBootstrap() {
  if (window.__BOK_BROWSER_PERFORMANCE__) return;
  const state = { longTasks: [], lagSamples: [] };
  try {
    const observer = new PerformanceObserver((list) => {
      const now = performance.now();
      for (const entry of list.getEntries()) state.longTasks.push({ at: now, duration: entry.duration });
      state.longTasks = state.longTasks.filter((item) => now - item.at <= 15_000);
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {}
  let expected = performance.now() + 100;
  const timer = setInterval(() => {
    const now = performance.now();
    state.lagSamples.push({ at: now, lag: Math.max(0, now - expected) });
    state.lagSamples = state.lagSamples.filter((item) => now - item.at <= 15_000);
    expected = now + 100;
  }, 100);
  window.__BOK_BROWSER_PERFORMANCE__ = {
    snapshot() {
      const now = performance.now();
      state.longTasks = state.longTasks.filter((item) => now - item.at <= 10_000);
      state.lagSamples = state.lagSamples.filter((item) => now - item.at <= 10_000);
      return {
        eventLoopLagMs: state.lagSamples.length ? Math.max(...state.lagSamples.filter((item) => now - item.at <= 1500).map((item) => item.lag), 0) : 0,
        longTasks10s: state.longTasks.length,
        maxLongTaskMs10s: state.longTasks.length ? Math.max(...state.longTasks.map((item) => item.duration)) : 0
      };
    },
    cleanup() { clearInterval(timer); }
  };
}

const number = (value, digits = 1) => value === null || value === undefined ? 'n/a' : Number(value).toFixed(digits);

export function createBrowserPerformancePlugin() {
  const processSampler = new ChromeProcessSampler();
  const physicalGpu = detectPhysicalGpuTelemetry();
  return {
    id: 'browser-performance',
    pageScripts: [`(${pageBootstrap.toString()})()`],
    hudSections: [
      { id: 'renderer', title: 'Renderer', order: 10 },
      { id: 'gpu-process', title: 'Chrome GPU process', order: 20 },
      { id: 'responsiveness', title: 'Responsiveness', order: 30 }
    ],
    csvFields: [
      csvField('rendererCpu', 'processes.renderer.cpu'), csvField('rendererRssMb', 'processes.renderer.rssMb'),
      csvField('rendererPrivateMb', 'processes.renderer.privateMb'), csvField('rendererProcessCount', 'processes.renderer.count'),
      csvField('chromeGpuProcessCpu', 'processes.gpu.cpu'), csvField('chromeGpuProcessRssMb', 'processes.gpu.rssMb'),
      csvField('chromeGpuProcessPrivateMb', 'processes.gpu.privateMb'), csvField('chromeGpuProcessCount', 'processes.gpu.count'),
      csvField('physicalGpuUtil', 'physicalGpu.gpuUtil'), csvField('videoDecodeUtil', 'physicalGpu.videoDecodeUtil'),
      csvField('physicalGpuMemoryUsedMb', 'physicalGpu.memoryUsedMb'), csvField('physicalGpuMemoryTotalMb', 'physicalGpu.memoryTotalMb'),
      csvField('eventLoopLagMs', 'local.eventLoopLagMs'), csvField('longTasks10s', 'local.longTasks10s'),
      csvField('maxLongTaskMs10s', 'local.maxLongTaskMs10s')
    ],
    describeEnvironment: () => ({
      physicalGpu: {
        available: physicalGpu.available,
        provider: physicalGpu.provider,
        reason: physicalGpu.reason ?? null,
        tools: physicalGpu.tools,
        adapters: physicalGpu.adapters
      }
    }),
    async setup(context) {
      await processSampler.sample(context.browserCdp);
    },
    async sample(context) {
      const [processes, local] = await Promise.all([
        processSampler.sample(context.browserCdp),
        context.evaluate('window.__BOK_BROWSER_PERFORMANCE__?.snapshot()')
      ]);
      const physical = physicalGpu.sample();
      return {
        patch: { processes, physicalGpu: physical, local },
        hud: {
          renderer: [`CPU ${number(processes.renderer.cpu)}% | RSS ${number(processes.renderer.rssMb, 0)} MB | private ${number(processes.renderer.privateMb, 0)} MB | ×${processes.renderer.count}`],
          'gpu-process': [
            `CPU ${number(processes.gpu.cpu)}% | RSS ${number(processes.gpu.rssMb, 0)} MB | private ${number(processes.gpu.privateMb, 0)} MB | ×${processes.gpu.count}`,
            physical.available
              ? `Physical GPU ${number(physical.gpuUtil, 0)}% | decode ${number(physical.videoDecodeUtil, 0)}% | VRAM ${number(physical.memoryUsedMb, 0)}/${number(physical.memoryTotalMb, 0)} MB`
              : 'Physical GPU utilization: unavailable'
          ],
          responsiveness: [`Lag ${number(local.eventLoopLagMs)} ms | long tasks 10s=${local.longTasks10s} | max=${number(local.maxLongTaskMs10s)} ms`]
        }
      };
    }
  };
}
