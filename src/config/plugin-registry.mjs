import { createBrowserPerformancePlugin } from '../plugins/browser-performance/index.mjs';
import { createCanvasPlugin } from '../plugins/canvas/index.mjs';
import { createDomPlugin } from '../plugins/dom/index.mjs';
import { createHlsJsPlugin } from '../plugins/hls-js/index.mjs';
import { createMediaObjectsPlugin } from '../plugins/media-objects/index.mjs';
import { createMemoryPlugin } from '../plugins/memory/index.mjs';
import { createNetworkPlugin } from '../plugins/network/index.mjs';
import { createVideoPlugin } from '../plugins/video/index.mjs';

export const pluginRegistry = new Map([
  ['browser-performance', createBrowserPerformancePlugin],
  ['memory', createMemoryPlugin],
  ['dom', createDomPlugin],
  ['network', createNetworkPlugin],
  ['video', createVideoPlugin],
  ['canvas', createCanvasPlugin],
  ['media-objects', createMediaObjectsPlugin],
  ['hls-js', createHlsJsPlugin]
]);

export function createPlugin(entry) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.sample === 'function') return entry;
  const [id, options] = Array.isArray(entry) ? entry : [entry, undefined];
  const factory = pluginRegistry.get(id);
  if (!factory) throw new Error(`Unknown plugin: ${id}`);
  return factory(options);
}
