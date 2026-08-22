import { csvField } from '../../core/artifacts.mjs';

function pageBootstrap(config) {
  if (window.__BOK_CANVAS__) return;
  const originalRaf = window.requestAnimationFrame.bind(window);
  const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const lastFrameByVideo = new WeakMap();
  const totals = { raf: 0, drawImage: 0, getContext: 0, repeatedDraw: 0, newDrawFrame: 0 };
  const previous = {};
  let lastSnapshotAt = performance.now();
  window.requestAnimationFrame = function wrapped(callback) {
    return originalRaf((timestamp) => { totals.raf++; callback(timestamp); });
  };
  CanvasRenderingContext2D.prototype.drawImage = function wrapped(...args) {
    totals.drawImage++;
    const source = args[0];
    if (source instanceof HTMLVideoElement) {
      let frame = 0;
      try { frame = source.getVideoPlaybackQuality?.().totalVideoFrames ?? source.webkitDecodedFrameCount ?? 0; } catch {}
      if (lastFrameByVideo.get(source) === frame) totals.repeatedDraw++;
      else totals.newDrawFrame++;
      lastFrameByVideo.set(source, frame);
    }
    return originalDrawImage.apply(this, args);
  };
  HTMLCanvasElement.prototype.getContext = function wrapped(...args) {
    totals.getContext++;
    return originalGetContext.apply(this, args);
  };
  window.__BOK_CANVAS__ = {
    snapshot() {
      const now = performance.now();
      const elapsed = Math.max(0.001, (now - lastSnapshotAt) / 1000);
      const delta = (key) => {
        const result = (totals[key] - (previous[key] ?? 0)) / elapsed;
        previous[key] = totals[key];
        return result;
      };
      const rates = { raf: delta('raf'), drawImage: delta('drawImage'), getContext: delta('getContext'), repeatedDraw: delta('repeatedDraw'), newDrawFrame: delta('newDrawFrame') };
      rates.repeatedPercent = rates.drawImage > 0 ? rates.repeatedDraw / rates.drawImage * 100 : 0;
      lastSnapshotAt = now;
      return {
        rates,
        canvasCount: document.querySelectorAll('canvas').length,
        canvasActive: config.activitySelector ? Boolean(document.querySelector(config.activitySelector)) : null
      };
    }
  };
}

const number = (value, digits = 1) => value === null || value === undefined ? 'n/a' : Number(value).toFixed(digits);

export function createCanvasPlugin({ activitySelector = null } = {}) {
  return {
    id: 'canvas',
    pageScripts: [`(${pageBootstrap.toString()})(${JSON.stringify({ activitySelector })})`],
    hudSections: [{ id: 'canvas', title: 'Canvas', order: 80 }],
    csvFields: [
      csvField('rafPerSec', 'local.rates.raf'), csvField('drawImagePerSec', 'local.rates.drawImage'),
      csvField('getContextPerSec', 'local.rates.getContext'), csvField('newFramesPerSec', 'local.rates.newVideoFrames'),
      csvField('repeatedDrawPerSec', 'local.rates.repeatedDraw'), csvField('repeatedDrawPercent', 'local.rates.repeatedPercent'),
      csvField('canvasCount', 'local.canvasCount'), csvField('canvasActive', 'local.canvasActive')
    ],
    async sample(context) {
      const local = await context.evaluate('window.__BOK_CANVAS__?.snapshot()');
      return {
        patch: { local },
        hud: { canvas: [`RAF ${number(local.rates.raf)}/s | draw ${number(local.rates.drawImage)}/s | repeated ${number(local.rates.repeatedDraw)}/s (${number(local.rates.repeatedPercent, 0)}%) | getContext ${number(local.rates.getContext)}/s | count ${local.canvasCount}${activitySelector ? ` | active=${local.canvasActive}` : ''}`] }
      };
    }
  };
}
