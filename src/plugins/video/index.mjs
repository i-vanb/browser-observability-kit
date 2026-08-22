import { csvField } from '../../core/artifacts.mjs';

function pageBootstrap(config) {
  if (window.__BOK_VIDEO__) return;
  const targets = config.targets || [];
  const infoByVideo = new WeakMap();
  const attached = new WeakSet();
  const events = [];
  let lastSnapshotAt = performance.now();
  const findVideo = (target) => {
    const values = [...document.querySelectorAll(target.selector || 'video')];
    return values[target.index || 0] instanceof HTMLVideoElement ? values[target.index || 0] : null;
  };
  const targetFor = (video) => targets.find((target) => findVideo(target) === video);
  const pushEvent = (type, data) => {
    events.push({ timestamp: new Date().toISOString(), type, ...data });
    if (events.length > 5000) events.splice(0, events.length - 5000);
  };
  const attach = (video) => {
    if (!video || attached.has(video)) return;
    attached.add(video);
    const info = { frames: 0, previousFrames: 0, previousDropped: 0, seeking: 0, waiting: 0, stalled: 0, errors: 0 };
    infoByVideo.set(video, info);
    for (const type of ['seeking', 'seeked', 'waiting', 'stalled', 'playing', 'canplay', 'pause', 'error']) {
      video.addEventListener(type, () => {
        if (type === 'seeking') info.seeking++;
        if (type === 'waiting') info.waiting++;
        if (type === 'stalled') info.stalled++;
        if (type === 'error') info.errors++;
        const target = targetFor(video);
        pushEvent(`video-${type}`, {
          target: target?.id ?? 'unknown',
          currentTime: video.currentTime,
          readyState: video.readyState,
          networkState: video.networkState,
          error: video.error ? { code: video.error.code, message: video.error.message } : null
        });
      }, { passive: true });
    }
    if (typeof video.requestVideoFrameCallback === 'function') {
      const observe = () => {
        if (!video.isConnected) return;
        info.frames++;
        video.requestVideoFrameCallback(observe);
      };
      video.requestVideoFrameCallback(observe);
    }
  };
  const bufferedAhead = (video) => {
    try {
      for (let index = 0; index < video.buffered.length; index++) {
        if (video.buffered.start(index) <= video.currentTime && video.currentTime <= video.buffered.end(index)) {
          return Math.max(0, video.buffered.end(index) - video.currentTime);
        }
      }
    } catch {}
    return 0;
  };
  window.__BOK_VIDEO__ = {
    snapshot() {
      const now = performance.now();
      const elapsed = Math.max(0.001, (now - lastSnapshotAt) / 1000);
      const videos = targets.map((target) => {
        const video = findVideo(target);
        if (!video) return { id: target.id, label: target.label ?? target.id, missing: true };
        attach(video);
        const info = infoByVideo.get(video);
        let quality = { totalVideoFrames: info.frames, droppedVideoFrames: 0 };
        try { quality = video.getVideoPlaybackQuality?.() ?? quality; } catch {}
        const total = Number(quality.totalVideoFrames ?? info.frames);
        const dropped = Number(quality.droppedVideoFrames ?? 0);
        const frameDelta = Math.max(0, total - info.previousFrames);
        const droppedDelta = Math.max(0, dropped - info.previousDropped);
        info.previousFrames = total;
        info.previousDropped = dropped;
        return {
          id: target.id,
          label: target.label ?? target.id,
          currentTime: video.currentTime,
          readyState: video.readyState,
          networkState: video.networkState,
          paused: video.paused,
          seeking: video.seeking,
          bufferedAhead: bufferedAhead(video),
          fps: frameDelta / elapsed,
          droppedTotal: dropped,
          droppedPerSec: droppedDelta / elapsed,
          seeks: info.seeking,
          waiting: info.waiting,
          stalled: info.stalled,
          errors: info.errors,
          presentedFrames: total
        };
      });
      lastSnapshotAt = now;
      return { videos, domVideoCount: document.querySelectorAll('video').length, events: events.splice(0) };
    }
  };
}

const number = (value, digits = 1) => value === null || value === undefined || Number.isNaN(Number(value)) ? 'n/a' : Number(value).toFixed(digits);

export function createVideoPlugin({ targets = [] } = {}) {
  const csvFields = [];
  for (const [index, target] of targets.entries()) {
    if (!target.id) throw new Error('Every video target must define an id');
    const prefix = target.csvPrefix ?? target.id;
    const base = `local.videos.${index}`;
    for (const [suffix, key] of [
      ['CurrentTime', 'currentTime'], ['ReadyState', 'readyState'], ['NetworkState', 'networkState'],
      ['Paused', 'paused'], ['Seeking', 'seeking'], ['BufferedAhead', 'bufferedAhead'], ['Fps', 'fps'],
      ['Dropped', 'droppedTotal'], ['DroppedPerSec', 'droppedPerSec'], ['Seeks', 'seeks'],
      ['Waiting', 'waiting'], ['Stalled', 'stalled'], ['MediaErrors', 'errors']
    ]) csvFields.push(csvField(`${prefix}${suffix}`, `${base}.${key}`));
  }
  return {
    id: 'video',
    pageScripts: [`(${pageBootstrap.toString()})(${JSON.stringify({ targets })})`],
    hudSections: targets.map((target, index) => ({ id: `video-${target.id}`, title: `Video: ${target.label ?? target.id}`, order: 100 + index })),
    csvFields,
    async sample(context) {
      const result = await context.evaluate('window.__BOK_VIDEO__?.snapshot()');
      for (const event of result.events ?? []) context.recordEvent(event.type, Object.fromEntries(Object.entries(event).filter(([key]) => !['type', 'timestamp'].includes(key))), event.timestamp);
      const hud = {};
      for (const video of result.videos) {
        hud[`video-${video.id}`] = video.missing ? ['not found'] : [
          `t=${number(video.currentTime)} ready=${video.readyState} network=${video.networkState} paused=${video.paused} seeking=${video.seeking}`,
          `buffer=${number(video.bufferedAhead)}s fps=${number(video.fps)} dropped=${video.droppedTotal}(+${number(video.droppedPerSec)}/s) seeks=${video.seeks} wait=${video.waiting} stall=${video.stalled} err=${video.errors}`
        ];
      }
      const newVideoFrames = result.videos.reduce((sum, video) => sum + (Number(video.fps) || 0), 0);
      return { patch: { local: { videos: result.videos, domVideoCount: result.domVideoCount, rates: { newVideoFrames } } }, hud };
    }
  };
}
