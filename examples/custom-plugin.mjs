import { csvField } from '../src/core/artifacts.mjs';

export function createTitlePlugin() {
  return {
    id: 'document-title',
    hudSections: [{ id: 'document-title', title: 'Document', order: 5 }],
    csvFields: [csvField('documentTitle', 'document.title')],
    async sample(context) {
      const title = await context.evaluate('document.title');
      return { patch: { document: { title } }, hud: { 'document-title': [title] } };
    }
  };
}
