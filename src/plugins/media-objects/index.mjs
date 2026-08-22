import { csvField } from '../../core/artifacts.mjs';

function pageBootstrap() {
  if (window.__BOK_MEDIA_OBJECTS__) return;
  const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
  const originalAdd = typeof MediaSource === 'function' ? MediaSource.prototype.addSourceBuffer : null;
  const originalRemove = typeof MediaSource === 'function' ? MediaSource.prototype.removeSourceBuffer : null;
  const knownMediaSources = new WeakSet();
  const knownSourceBuffers = new WeakSet();
  const byMediaSource = new WeakMap();
  const state = { mediaSource: 0, sourceBuffer: 0 };
  URL.createObjectURL = function wrapped(value) {
    if (typeof MediaSource === 'function' && value instanceof MediaSource && !knownMediaSources.has(value)) {
      knownMediaSources.add(value);
      byMediaSource.set(value, new Set());
      state.mediaSource++;
      value.addEventListener('sourceclose', () => {
        state.mediaSource = Math.max(0, state.mediaSource - 1);
        const buffers = byMediaSource.get(value);
        if (buffers) {
          state.sourceBuffer = Math.max(0, state.sourceBuffer - buffers.size);
          buffers.clear();
        }
      }, { once: true });
    }
    return originalCreateObjectUrl(value);
  };
  if (originalAdd) {
    MediaSource.prototype.addSourceBuffer = function wrapped(...args) {
      const buffer = originalAdd.apply(this, args);
      if (!knownSourceBuffers.has(buffer)) {
        knownSourceBuffers.add(buffer);
        state.sourceBuffer++;
        let buffers = byMediaSource.get(this);
        if (!buffers) { buffers = new Set(); byMediaSource.set(this, buffers); }
        buffers.add(buffer);
      }
      return buffer;
    };
  }
  if (originalRemove) {
    MediaSource.prototype.removeSourceBuffer = function wrapped(buffer) {
      const buffers = byMediaSource.get(this);
      if (buffers?.delete(buffer)) state.sourceBuffer = Math.max(0, state.sourceBuffer - 1);
      return originalRemove.call(this, buffer);
    };
  }
  window.__BOK_MEDIA_OBJECTS__ = { snapshot: () => ({ mediaSource: state.mediaSource, sourceBuffer: state.sourceBuffer }) };
}

export function createMediaObjectsPlugin() {
  return {
    id: 'media-objects',
    pageScripts: [`(${pageBootstrap.toString()})()`],
    hudSections: [{ id: 'media-objects', title: 'Media objects', order: 140 }],
    csvFields: [csvField('domVideoCount', 'local.domVideoCount'), csvField('mediaSourceCount', 'objects.mediaSource'), csvField('sourceBufferCount', 'objects.sourceBuffer'), csvField('eventSourceCount', 'objects.eventSource')],
    async sample(context, currentSample) {
      const objects = await context.evaluate('window.__BOK_MEDIA_OBJECTS__?.snapshot()');
      const eventSource = currentSample.objects?.eventSource ?? currentSample.network?.activeEventSources ?? 0;
      objects.eventSource = eventSource;
      return {
        patch: { objects },
        hud: { 'media-objects': [`video=${currentSample.local?.domVideoCount ?? currentSample.dom?.video ?? 0} | MediaSource=${objects.mediaSource} | SourceBuffer=${objects.sourceBuffer} | EventSource=${eventSource}`] }
      };
    }
  };
}
