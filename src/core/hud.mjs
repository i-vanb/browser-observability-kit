export function hudBootstrap(options = {}) {
  if (window.__BROWSER_OBSERVABILITY_KIT__) return;
  const config = {
    title: options.title || 'BROWSER OBSERVABILITY',
    marks: Array.isArray(options.marks) && options.marks.length ? options.marks : ['BASELINE', 'ACTION', 'RECOVERY', 'CUSTOM']
  };
  const state = {
    phase: 'READY',
    pendingMark: '',
    sections: new Map(),
    latestLines: {},
    events: [],
    hud: null,
    content: null,
    body: null
  };

  const pushEvent = (type, data = {}) => {
    state.events.push({ timestamp: new Date().toISOString(), type, ...data });
    if (state.events.length > 5000) state.events.splice(0, state.events.length - 5000);
  };

  const mark = (label) => {
    const normalized = String(label || 'CUSTOM').trim().slice(0, 80) || 'CUSTOM';
    state.phase = normalized;
    state.pendingMark = normalized;
    pushEvent('mark', { label: normalized });
    render();
  };

  const registerSection = ({ id, title = id, order = 100 }) => {
    state.sections.set(id, { id, title, order });
    render();
  };

  const update = ({ sections = {} } = {}) => {
    Object.assign(state.latestLines, sections);
    render();
  };

  function render() {
    if (!state.hud || !state.body) return;
    const phase = state.hud.querySelector('[data-bok-phase]');
    if (phase) phase.textContent = state.phase;
    const blocks = [...state.sections.values()]
      .sort((a, b) => a.order - b.order)
      .flatMap((section) => {
        const lines = state.latestLines[section.id] ?? [];
        return lines.length ? [`[${section.title}]`, ...lines] : [];
      });
    state.body.textContent = blocks.length ? blocks.join('\n') : 'Waiting for first sample…';
  }

  function createHud() {
    if (!document.body || document.querySelector('[data-browser-observability-hud]')) return;
    const hud = document.createElement('section');
    hud.dataset.browserObservabilityHud = 'true';
    hud.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px', 'width:390px', 'z-index:2147483647',
      'background:rgba(7,12,22,.92)', 'color:#d9f2ff', 'border:1px solid #4d6f86',
      'border-radius:8px', 'box-shadow:0 4px 20px rgba(0,0,0,.5)',
      'font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace', 'user-select:none'
    ].join(';');
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;background:#142334;cursor:move;border-radius:8px 8px 0 0';
    const title = document.createElement('strong');
    title.textContent = config.title;
    title.style.flex = '1';
    const phase = document.createElement('span');
    phase.dataset.bokPhase = 'true';
    phase.style.cssText = 'color:#7fffd4;max-width:140px;overflow:hidden;text-overflow:ellipsis';
    const collapse = document.createElement('button');
    collapse.textContent = '−';
    collapse.title = 'Collapse/expand HUD';
    collapse.style.cssText = 'width:24px;height:22px;padding:0;background:#263c51;color:white;border:1px solid #52718b;border-radius:4px;cursor:pointer';
    header.append(title, phase, collapse);
    const content = document.createElement('div');
    content.style.cssText = 'padding:7px 8px 8px;max-height:calc(100vh - 60px);overflow:auto';
    const marks = document.createElement('div');
    marks.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px';
    for (const label of config.marks) {
      const button = document.createElement('button');
      button.textContent = label;
      button.dataset.bokMark = label;
      button.style.cssText = 'padding:2px 5px;background:#20374b;color:#d9f2ff;border:1px solid #52718b;border-radius:3px;font:10px ui-monospace,monospace;cursor:pointer';
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (label === 'CUSTOM') {
          const custom = prompt('Diagnostic MARK label', 'CUSTOM');
          if (custom !== null) mark(custom);
        } else mark(label);
      });
      marks.append(button);
    }
    const body = document.createElement('pre');
    body.dataset.bokBody = 'true';
    body.style.cssText = 'margin:0;white-space:pre-wrap;user-select:text;color:#d9f2ff';
    content.append(marks, body);
    hud.append(header, content);
    document.body.append(hud);
    collapse.addEventListener('click', (event) => {
      event.stopPropagation();
      const hidden = content.style.display === 'none';
      content.style.display = hidden ? 'block' : 'none';
      collapse.textContent = hidden ? '−' : '+';
    });
    let drag = null;
    header.addEventListener('pointerdown', (event) => {
      if (event.target === collapse) return;
      const rect = hud.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      header.setPointerCapture?.(event.pointerId);
    });
    header.addEventListener('pointermove', (event) => {
      if (!drag) return;
      hud.style.left = `${Math.max(0, Math.min(innerWidth - hud.offsetWidth, event.clientX - drag.dx))}px`;
      hud.style.top = `${Math.max(0, Math.min(innerHeight - hud.offsetHeight, event.clientY - drag.dy))}px`;
      hud.style.right = 'auto';
    });
    header.addEventListener('pointerup', () => { drag = null; });
    header.addEventListener('pointercancel', () => { drag = null; });
    state.hud = hud;
    state.content = content;
    state.body = body;
    render();
  }

  document.addEventListener('DOMContentLoaded', createHud, { once: true });
  if (document.readyState !== 'loading') createHud();
  const observer = new MutationObserver(createHud);
  const observe = () => document.documentElement && observer.observe(document.documentElement, { childList: true, subtree: true });
  document.documentElement ? observe() : document.addEventListener('DOMContentLoaded', observe, { once: true });
  document.addEventListener('keydown', (event) => {
    if (!event.altKey || event.key.toLowerCase() !== 'm') return;
    event.preventDefault();
    const custom = prompt('Diagnostic MARK label', 'CUSTOM');
    if (custom !== null) mark(custom);
  }, true);
  window.__BROWSER_OBSERVABILITY_KIT__ = {
    state,
    mark,
    registerSection,
    update,
    createHud,
    takeCoreSnapshot() {
      const result = { phase: state.phase, mark: state.pendingMark, events: state.events.splice(0) };
      state.pendingMark = '';
      return result;
    }
  };
}

export function hudSource(options) {
  return `(${hudBootstrap.toString()})(${JSON.stringify(options ?? {})})`;
}
