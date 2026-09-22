import { csvField } from '../../core/artifacts.mjs';
import { ChromeProcessSampler, detectPhysicalGpuTelemetry } from '../../core/process-metrics.mjs';
import { installResponsivenessProbe } from '../../browser/probes.mjs';

const number = (value, digits = 1) => value === null || value === undefined ? 'n/a' : Number(value).toFixed(digits);

export function createBrowserPerformancePlugin() {
  const processSampler = new ChromeProcessSampler();
  const physicalGpu = detectPhysicalGpuTelemetry();
  return {
    id: 'browser-performance',
    pageScripts: [`(${installResponsivenessProbe.toString()})()`],
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
          responsiveness: [`Lag ${number(local.eventLoopLagMs)} ms | long tasks 10s=${number(local.longTasks10s, 0)} | max=${number(local.maxLongTaskMs10s)} ms`]
        }
      };
    }
  };
}
