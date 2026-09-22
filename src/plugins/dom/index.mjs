import { csvField } from '../../core/artifacts.mjs';
import { takeDomSnapshot } from '../../browser/probes.mjs';

export function createDomPlugin() {
  return {
    id: 'dom',
    hudSections: [{ id: 'dom', title: 'DOM', order: 50 }],
    csvFields: [
      csvField('domElements', 'dom.elements'), csvField('iframes', 'dom.iframes'),
      csvField('canvasElements', 'dom.canvas'), csvField('videoElements', 'dom.video'), csvField('audioElements', 'dom.audio')
    ],
    async sample(context) {
      const dom = await context.evaluate(`(${takeDomSnapshot.toString()})()`);
      return { patch: { dom }, hud: { dom: [`Elements ${dom.elements} | iframe ${dom.iframes} | video ${dom.video} | canvas ${dom.canvas} | audio ${dom.audio}`] } };
    }
  };
}
