import { csvField } from '../../core/artifacts.mjs';
import { installCanvasProbe } from '../../browser/probes.mjs';

const number = (value, digits = 1) => value === null || value === undefined ? 'n/a' : Number(value).toFixed(digits);

export function createCanvasPlugin({ activitySelector = null } = {}) {
  return {
    id: 'canvas',
    pageScripts: [`(${installCanvasProbe.toString()})(window, ${JSON.stringify({ activitySelector })})`],
    hudSections: [{ id: 'canvas', title: 'Canvas', order: 80 }],
    csvFields: [
      csvField('rafPerSec', 'local.rates.raf'), csvField('drawImagePerSec', 'local.rates.drawImage'),
      csvField('getContextPerSec', 'local.rates.getContext'), csvField('newFramesPerSec', 'local.rates.newDrawFrame'),
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
