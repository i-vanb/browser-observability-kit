import { csvField } from '../../core/artifacts.mjs';

const number = (value, digits = 1) => value === null || value === undefined ? 'n/a' : Number(value).toFixed(digits);
const metricMap = (metrics) => Object.fromEntries((metrics.metrics ?? []).map((entry) => [entry.name, entry.value]));

export function createMemoryPlugin({ includeHeapTotalCsv = true } = {}) {
  return {
    id: 'memory',
    hudSections: [{ id: 'memory', title: 'Memory / CDP DOM', order: 40 }],
    csvFields: [
      csvField('heapUsedMb', 'performance.heapUsedMb'), ...(includeHeapTotalCsv ? [csvField('heapTotalMb', 'performance.heapTotalMb')] : []),
      csvField('documents', 'performance.documents'), csvField('nodes', 'performance.nodes'),
      csvField('listeners', 'performance.listeners')
    ],
    async sample(context) {
      const [performanceMetrics, dom] = await Promise.all([
        context.pageCdp.send('Performance.getMetrics'),
        context.pageCdp.send('Memory.getDOMCounters')
      ]);
      const metrics = metricMap(performanceMetrics);
      const performance = {
        heapUsedMb: Number(metrics.JSHeapUsedSize ?? 0) / 1024 / 1024,
        heapTotalMb: Number(metrics.JSHeapTotalSize ?? 0) / 1024 / 1024,
        documents: dom.documents,
        nodes: dom.nodes,
        listeners: dom.jsEventListeners
      };
      return {
        patch: { performance },
        hud: { memory: [`Heap ${number(performance.heapUsedMb)} / ${number(performance.heapTotalMb)} MB | documents ${performance.documents} | nodes ${performance.nodes} | listeners ${performance.listeners}`] }
      };
    }
  };
}
