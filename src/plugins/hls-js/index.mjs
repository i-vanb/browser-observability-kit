import { csvField } from '../../core/artifacts.mjs';
import { serializeRemoteObject } from '../../core/cdp.mjs';

export function createHlsJsPlugin({ targetPatterns = [], consoleErrorParser = null, recoveryConsoleParser = null } = {}) {
  const state = {
    errors: [],
    recovery: Object.fromEntries([...targetPatterns.map((target) => target.id), 'unknown'].map((id) => [id, 0]))
  };
  const targetForUrl = (url) => targetPatterns.find((target) => target.pattern.test(url))?.id ?? 'unknown';
  const fields = [csvField('hlsErrors10s', 'hls.errors10s'), csvField('fatalHlsErrors10s', 'hls.fatalErrors10s')];
  for (const target of targetPatterns) fields.push(csvField(`${target.id}Recovery`, `hls.recovery.${target.id}`));
  fields.push(csvField('unknownRecovery', 'hls.recovery.unknown'));
  return {
    id: 'hls-js',
    domains: ['Runtime', 'Media'],
    hudSections: [{ id: 'hls-js', title: 'hls.js', order: 135 }],
    csvFields: fields,
    setup(context) {
      context.pageCdp.on('Runtime.consoleAPICalled', async (params) => {
        if (!consoleErrorParser && !recoveryConsoleParser) return;
        const values = [];
        for (const argument of params.args ?? []) values.push(await serializeRemoteObject(context.pageCdp, argument));
        const timestamp = new Date(params.timestamp ?? Date.now()).toISOString();
        if (consoleErrorParser) {
          const parsed = await consoleErrorParser(values, { timestamp });
          if (parsed) {
            const target = parsed.target ?? targetForUrl(String(parsed.url ?? ''));
            const event = { target, ...parsed };
            state.errors.push({ at: Date.parse(timestamp), fatal: Boolean(event.fatal) });
            context.recordEvent('hls-error', event, timestamp);
          }
        }
        if (recoveryConsoleParser) {
          const parsed = await recoveryConsoleParser(values, { timestamp });
          if (parsed) {
            const target = parsed.target ?? 'unknown';
            state.recovery[target] = (state.recovery[target] ?? 0) + 1;
            context.recordEvent('hls-recovery', { target, ...parsed }, timestamp);
          }
        }
      });
      context.pageCdp.on('Media.playerErrorsRaised', (params) => context.recordEvent('media-player-errors', params));
      context.pageCdp.on('Media.playerMessagesLogged', (params) => {
        for (const message of (params.messages ?? []).filter((item) => item.level === 'error')) {
          context.recordEvent('media-player-message', { playerId: params.playerId, ...message });
        }
      });
    },
    sample() {
      const now = Date.now();
      state.errors = state.errors.filter((error) => now - error.at <= 10_000);
      const hls = {
        errors10s: state.errors.length,
        fatalErrors10s: state.errors.filter((error) => error.fatal).length,
        recovery: { ...state.recovery }
      };
      const recoveryLine = Object.entries(hls.recovery).map(([id, count]) => `${id}=${count}`).join(' ');
      return { patch: { hls }, hud: { 'hls-js': [`errors 10s=${hls.errors10s} | fatal=${hls.fatalErrors10s} | recovery ${recoveryLine}`] } };
    }
  };
}
