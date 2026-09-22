export function installResponsivenessProbe(target = window) {
  if (target.__BOK_BROWSER_PERFORMANCE__) return target.__BOK_BROWSER_PERFORMANCE__;

  const performanceApi = target.performance;
  const state = { longTasks: [], lagSamples: [] };
  const PerformanceObserverApi = target.PerformanceObserver;
  const supportedEntryTypes = PerformanceObserverApi?.supportedEntryTypes;
  let longTasksSupported = false;
  let observer = null;

  if (!supportedEntryTypes || supportedEntryTypes.includes('longtask')) {
    try {
      observer = new PerformanceObserverApi((list) => {
        const now = performanceApi.now();
        for (const entry of list.getEntries()) {
          state.longTasks.push({ at: now, duration: entry.duration });
        }
        state.longTasks = state.longTasks.filter((item) => now - item.at <= 15_000);
      });
      observer.observe({ type: 'longtask', buffered: true });
      longTasksSupported = true;
    } catch {
      observer = null;
    }
  }

  let expected = performanceApi.now() + 100;
  const timer = target.setInterval(() => {
    const now = performanceApi.now();
    state.lagSamples.push({ at: now, lag: Math.max(0, now - expected) });
    state.lagSamples = state.lagSamples.filter((item) => now - item.at <= 15_000);
    expected = now + 100;
  }, 100);

  const probe = {
    snapshot() {
      const now = performanceApi.now();
      state.longTasks = state.longTasks.filter((item) => now - item.at <= 10_000);
      state.lagSamples = state.lagSamples.filter((item) => now - item.at <= 10_000);
      const recentLag = state.lagSamples
        .filter((item) => now - item.at <= 1500)
        .map((item) => item.lag);

      return {
        eventLoopLagMs: recentLag.length ? Math.max(...recentLag, 0) : 0,
        longTasksSupported,
        longTasks10s: longTasksSupported ? state.longTasks.length : null,
        maxLongTaskMs10s: longTasksSupported && state.longTasks.length
          ? Math.max(...state.longTasks.map((item) => item.duration))
          : longTasksSupported ? 0 : null
      };
    },
    destroy() {
      target.clearInterval(timer);
      observer?.disconnect();
      if (target.__BOK_BROWSER_PERFORMANCE__ === probe) {
        delete target.__BOK_BROWSER_PERFORMANCE__;
      }
    }
  };

  target.__BOK_BROWSER_PERFORMANCE__ = probe;
  return probe;
}

export function installCanvasProbe(target = window, config = {}) {
  if (target.__BOK_CANVAS__) return target.__BOK_CANVAS__;

  const Context2D = target.CanvasRenderingContext2D;
  const CanvasElement = target.HTMLCanvasElement;
  const VideoElement = target.HTMLVideoElement;
  const originalRaf = target.requestAnimationFrame;
  const originalDrawImage = Context2D?.prototype.drawImage;
  const originalGetContext = CanvasElement?.prototype.getContext;
  const lastFrameByVideo = new WeakMap();
  const totals = { raf: 0, drawImage: 0, getContext: 0, repeatedDraw: 0, newDrawFrame: 0 };
  const previous = { ...totals };
  let lastSnapshotAt = target.performance.now();

  function wrappedRaf(callback) {
    return originalRaf.call(target, (timestamp) => {
      totals.raf++;
      callback(timestamp);
    });
  }

  function wrappedDrawImage(...args) {
    totals.drawImage++;
    const source = args[0];
    if (VideoElement && source instanceof VideoElement) {
      let frame = 0;
      try {
        frame = source.getVideoPlaybackQuality?.().totalVideoFrames
          ?? source.webkitDecodedFrameCount
          ?? 0;
      } catch {}
      if (lastFrameByVideo.get(source) === frame) totals.repeatedDraw++;
      else totals.newDrawFrame++;
      lastFrameByVideo.set(source, frame);
    }
    return originalDrawImage.apply(this, args);
  }

  function wrappedGetContext(...args) {
    totals.getContext++;
    return originalGetContext.apply(this, args);
  }

  if (typeof originalRaf === 'function') target.requestAnimationFrame = wrappedRaf;
  if (typeof originalDrawImage === 'function') Context2D.prototype.drawImage = wrappedDrawImage;
  if (typeof originalGetContext === 'function') CanvasElement.prototype.getContext = wrappedGetContext;

  const probe = {
    snapshot() {
      const now = target.performance.now();
      const elapsed = Math.max(0.001, (now - lastSnapshotAt) / 1000);
      const delta = (key) => {
        const result = (totals[key] - previous[key]) / elapsed;
        previous[key] = totals[key];
        return result;
      };
      const rates = {
        raf: delta('raf'),
        drawImage: delta('drawImage'),
        getContext: delta('getContext'),
        repeatedDraw: delta('repeatedDraw'),
        newDrawFrame: delta('newDrawFrame')
      };
      rates.repeatedPercent = rates.drawImage > 0
        ? rates.repeatedDraw / rates.drawImage * 100
        : 0;
      lastSnapshotAt = now;

      return {
        rates,
        canvasCount: target.document.querySelectorAll('canvas').length,
        canvasActive: config.activitySelector
          ? Boolean(target.document.querySelector(config.activitySelector))
          : null
      };
    },
    destroy() {
      if (target.requestAnimationFrame === wrappedRaf) target.requestAnimationFrame = originalRaf;
      if (Context2D?.prototype.drawImage === wrappedDrawImage) {
        Context2D.prototype.drawImage = originalDrawImage;
      }
      if (CanvasElement?.prototype.getContext === wrappedGetContext) {
        CanvasElement.prototype.getContext = originalGetContext;
      }
      if (target.__BOK_CANVAS__ === probe) delete target.__BOK_CANVAS__;
    }
  };

  target.__BOK_CANVAS__ = probe;
  return probe;
}

export function takeDomSnapshot(target = window) {
  return {
    elements: target.document.getElementsByTagName('*').length,
    iframes: target.document.querySelectorAll('iframe').length,
    canvas: target.document.querySelectorAll('canvas').length,
    video: target.document.querySelectorAll('video').length,
    audio: target.document.querySelectorAll('audio').length
  };
}
