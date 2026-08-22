import { csvField } from '../../core/artifacts.mjs';

function normalizeGroups(groups) {
  return Object.fromEntries(Object.entries(groups ?? {}).map(([id, expression]) => [id, expression instanceof RegExp ? expression : new RegExp(expression, 'i')]));
}

export function createNetworkPlugin({ groups = {}, legacy = {}, includeGenericCsv = true, eventTypePrefix = 'network' } = {}) {
  const expressions = normalizeGroups(groups);
  const state = {
    requests: new Map(),
    eventSources: new Set(),
    total: { requests: 0, failed: 0, bytes: 0 },
    groups: Object.fromEntries(Object.keys(expressions).map((id) => [id, { requests: 0, failed: 0, bytes: 0 }]))
  };
  const groupFor = (url) => Object.entries(expressions).find(([, expression]) => expression.test(url))?.[0] ?? null;
  const fields = includeGenericCsv ? [
    csvField('networkRequestsPerSec', 'network.requestsPerSec'), csvField('networkFailedPerSec', 'network.failedPerSec'),
    csvField('networkPending', 'network.pending'), csvField('networkBytesPerSec', 'network.bytesPerSec')
  ] : [];
  if (includeGenericCsv) for (const id of Object.keys(expressions)) {
    fields.push(csvField(`${id}PerSec`, `network.groups.${id}.requestsPerSec`));
    fields.push(csvField(`${id}FailedPerSec`, `network.groups.${id}.failedPerSec`));
  }
  for (const column of Object.keys(legacy)) fields.push(csvField(column, `network.${column}`));

  return {
    id: 'network',
    domains: ['Network'],
    hudSections: [{ id: 'network', title: 'Network', order: 130 }],
    csvFields: fields,
    setup(context) {
      context.pageCdp.on('Network.requestWillBeSent', (params) => {
        const url = params.request?.url ?? '';
        const group = groupFor(url);
        if (params.type === 'EventSource') state.eventSources.add(params.requestId);
        state.total.requests++;
        if (group) state.groups[group].requests++;
        state.requests.set(params.requestId, { url, group, failed: false });
      });
      context.pageCdp.on('Network.responseReceived', (params) => {
        const request = state.requests.get(params.requestId);
        if (!request) return;
        const status = Number(params.response?.status ?? 0);
        request.status = status;
        if (status >= 400 && !request.failed) {
          request.failed = true;
          state.total.failed++;
          if (request.group) state.groups[request.group].failed++;
          context.recordEvent(`${eventTypePrefix}-http-error`, { url: request.url, status, group: request.group });
        }
      });
      context.pageCdp.on('Network.loadingFinished', (params) => {
        state.eventSources.delete(params.requestId);
        const request = state.requests.get(params.requestId);
        if (!request) return;
        const bytes = Number(params.encodedDataLength ?? 0);
        state.total.bytes += bytes;
        if (request.group) state.groups[request.group].bytes += bytes;
        state.requests.delete(params.requestId);
      });
      context.pageCdp.on('Network.loadingFailed', (params) => {
        state.eventSources.delete(params.requestId);
        const request = state.requests.get(params.requestId);
        if (!request) return;
        if (!request.failed) {
          state.total.failed++;
          if (request.group) state.groups[request.group].failed++;
        }
        context.recordEvent(`${eventTypePrefix}-request-failed`, { url: request.url, group: request.group, errorText: params.errorText, canceled: params.canceled ?? false });
        state.requests.delete(params.requestId);
      });
    },
    sample() {
      const network = {
        requestsPerSec: state.total.requests,
        failedPerSec: state.total.failed,
        bytesPerSec: state.total.bytes,
        pending: state.requests.size,
        activeEventSources: state.eventSources.size,
        groups: {}
      };
      for (const [id, counters] of Object.entries(state.groups)) {
        const pending = [...state.requests.values()].filter((request) => request.group === id).length;
        network.groups[id] = { requestsPerSec: counters.requests, failedPerSec: counters.failed, bytesPerSec: counters.bytes, pending };
      }
      for (const [column, path] of Object.entries(legacy)) {
        if (typeof path === 'function') network[column] = path(network);
        else {
          const [groupId, property] = path.split('.');
          network[column] = network.groups[groupId]?.[property] ?? 0;
        }
      }
      state.total = { requests: 0, failed: 0, bytes: 0 };
      for (const id of Object.keys(state.groups)) state.groups[id] = { requests: 0, failed: 0, bytes: 0 };
      const groupLine = Object.entries(network.groups).map(([id, value]) => `${id}=${value.requestsPerSec}/s fail=${value.failedPerSec}/s`).join(' | ');
      return {
        patch: { network, objects: { eventSource: network.activeEventSources } },
        hud: { network: [`requests ${network.requestsPerSec}/s | failed ${network.failedPerSec}/s | pending ${network.pending} | ${(network.bytesPerSec / 1024).toFixed(1)} KiB/s`, groupLine].filter(Boolean) }
      };
    }
  };
}
