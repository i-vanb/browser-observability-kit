import {
  installCanvasProbe,
  installResponsivenessProbe,
  takeDomSnapshot
} from './probes.mjs';

const DEFAULT_SAMPLE_INTERVAL_MS = 1000;
const MIN_SAMPLE_INTERVAL_MS = 250;

export function createBrowserObserver({
  sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
  target = globalThis.window
} = {}) {
  if (!target?.document || !target?.performance) {
    throw new Error('browser-observability-kit/browser requires a browser window');
  }

  const intervalMs = Math.max(MIN_SAMPLE_INTERVAL_MS, Number(sampleIntervalMs) || DEFAULT_SAMPLE_INTERVAL_MS);
  const subscribers = new Set();
  let responsiveness = null;
  let canvas = null;
  let timer = null;
  let latest = null;
  let started = false;
  let destroyed = false;

  const collect = ({ notify = true } = {}) => {
    if (!started) throw new Error('Start the browser observer before taking a snapshot');
    const responsivenessSnapshot = responsiveness.snapshot();
    const canvasSnapshot = canvas.snapshot();
    const domSnapshot = takeDomSnapshot(target);
    latest = {
      timestamp: Date.now(),
      eventLoopLagMs: responsivenessSnapshot.eventLoopLagMs,
      longTasksSupported: responsivenessSnapshot.longTasksSupported,
      longTasks10s: responsivenessSnapshot.longTasks10s,
      longestTaskMs10s: responsivenessSnapshot.maxLongTaskMs10s,
      rafCallbacksPerSecond: canvasSnapshot.rates.raf,
      canvasDrawImageCallsPerSecond: canvasSnapshot.rates.drawImage,
      domElements: domSnapshot.elements
    };
    if (notify) {
      for (const subscriber of subscribers) subscriber(latest);
    }
    return latest;
  };

  const api = {
    start() {
      if (destroyed) throw new Error('Cannot restart a destroyed browser observer');
      if (started) return api;
      responsiveness = installResponsivenessProbe(target);
      canvas = installCanvasProbe(target);
      started = true;
      collect();
      timer = target.setInterval(collect, intervalMs);
      return api;
    },
    snapshot() {
      return collect({ notify: false });
    },
    subscribe(subscriber) {
      if (typeof subscriber !== 'function') {
        throw new TypeError('subscribe() requires a function');
      }
      subscribers.add(subscriber);
      if (latest) subscriber(latest);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    destroy() {
      if (destroyed) return;
      if (timer !== null) target.clearInterval(timer);
      responsiveness?.destroy();
      canvas?.destroy();
      subscribers.clear();
      timer = null;
      started = false;
      destroyed = true;
    }
  };

  return api;
}

export function start(options) {
  return createBrowserObserver(options).start();
}
