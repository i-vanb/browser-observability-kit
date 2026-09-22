import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserObserver } from '../src/browser/index.mjs';
import { installResponsivenessProbe } from '../src/browser/probes.mjs';

function createTarget({ PerformanceObserver } = {}) {
  class CanvasRenderingContext2D {
    drawImage() {
      return true;
    }
  }

  class HTMLCanvasElement {
    getContext() {
      return new CanvasRenderingContext2D();
    }
  }

  class HTMLVideoElement {}

  return {
    performance,
    PerformanceObserver,
    CanvasRenderingContext2D,
    HTMLCanvasElement,
    HTMLVideoElement,
    requestAnimationFrame(callback) {
      callback(performance.now());
      return 1;
    },
    setInterval,
    clearInterval,
    document: {
      getElementsByTagName() {
        return { length: 42 };
      },
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        return { length: selector === 'canvas' ? 1 : 0 };
      }
    }
  };
}

test('browser observer reports browser-safe metrics and restores instrumentation', () => {
  const target = createTarget();
  const originalRaf = target.requestAnimationFrame;
  const originalDrawImage = target.CanvasRenderingContext2D.prototype.drawImage;
  const observer = createBrowserObserver({ target, sampleIntervalMs: 10_000 }).start();

  target.requestAnimationFrame(() => {});
  new target.CanvasRenderingContext2D().drawImage({});
  const snapshot = observer.snapshot();

  assert.equal(snapshot.longTasksSupported, false);
  assert.equal(snapshot.longTasks10s, null);
  assert.equal(snapshot.longestTaskMs10s, null);
  assert.equal(snapshot.domElements, 42);
  assert.ok(snapshot.rafCallbacksPerSecond > 0);
  assert.ok(snapshot.canvasDrawImageCallsPerSecond > 0);

  observer.destroy();
  assert.equal(target.requestAnimationFrame, originalRaf);
  assert.equal(target.CanvasRenderingContext2D.prototype.drawImage, originalDrawImage);
});

test('responsiveness probe distinguishes supported long tasks from zero events', () => {
  class FakePerformanceObserver {
    static supportedEntryTypes = ['longtask'];
    static callback = null;

    constructor(callback) {
      FakePerformanceObserver.callback = callback;
    }

    observe() {}
    disconnect() {}
  }

  const target = createTarget({ PerformanceObserver: FakePerformanceObserver });
  const probe = installResponsivenessProbe(target);
  FakePerformanceObserver.callback({
    getEntries: () => [{ duration: 72 }]
  });
  const snapshot = probe.snapshot();

  assert.equal(snapshot.longTasksSupported, true);
  assert.equal(snapshot.longTasks10s, 1);
  assert.equal(snapshot.maxLongTaskMs10s, 72);
  probe.destroy();
});
