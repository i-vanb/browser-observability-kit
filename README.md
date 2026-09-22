# Browser Observability Kit

A dependency-free Node.js toolkit for observing browser applications through Chrome DevTools Protocol. It launches an isolated Chrome profile, injects a lightweight draggable HUD, samples metrics, and writes CSV/JSONL artifacts.

```text
CORE
  ↓
generic PLUGINS
  ↓
external CONFIG
  ↓
optional external SCENARIO
```

The repository contains no application-specific preset or workflow. Target selectors, network groups, commands, phases, and application semantics are supplied by external `.mjs` files.

## Requirements

- Node.js 22+
- Google Chrome or Chromium with CDP support
- Linux `/proc` for renderer and Chrome GPU-process memory
- A graphical session for the default headed mode

Physical GPU metrics are reported only when a supported system source is available. Chrome GPU-process CPU/RSS is labeled separately and is not treated as physical GPU utilization.

## Browser-safe observer

The `browser-observability-kit/browser` entrypoint runs inside an existing page and has no Node.js or CDP dependency. It reports only metrics available to that page:

- event-loop lag;
- Long Tasks support, count, and longest task over the last 10 seconds;
- `requestAnimationFrame` callbacks per second;
- Canvas `drawImage` calls per second;
- DOM element count.

```js
import { createBrowserObserver } from 'browser-observability-kit/browser';

const observer = createBrowserObserver({ sampleIntervalMs: 1000 });
observer.subscribe((snapshot) => {
  console.log(snapshot);
});
observer.start();

// Read immediately when needed.
observer.snapshot();

// Restore instrumented browser APIs and release timers.
observer.destroy();
```

Unsupported Long Tasks are reported with `longTasksSupported: false` and `null` values rather than zero. Process CPU, RSS, Chrome GPU-process, and physical GPU metrics remain exclusive to the Node.js/CDP runner.

## Run the HUD

```bash
cd ~/projects/browser-observability-kit

npm run hud -- \
  --url http://localhost:3000 \
  --config ./examples/basic.config.mjs
```

Video example:

```bash
npm run hud -- \
  --url http://localhost:5173 \
  --config ./examples/video.config.mjs
```

Options:

```text
--url <url>
--config <config.mjs>
--artifact-dir <directory>
--artifact-prefix <prefix>
--sample-ms <milliseconds>
--chrome-bin <path>
--smoke
--headless
```

Stop an interactive run with `Ctrl+C`.

## External configuration

Config chooses plugins and passes all target-specific settings:

```js
export default {
  plugins: [
    ['browser-performance'],
    ['memory'],
    ['dom'],
    ['network'],
    ['video', {
      targets: [
        { id: 'main', selector: 'video' }
      ]
    }]
  ]
};
```

Available plugin IDs:

- `browser-performance`
- `memory`
- `dom`
- `network`
- `video`
- `canvas`
- `media-objects`
- `hls-js`

Video target IDs have no defaults and are fully user-defined. Network groups and hls.js console parsers are also opt-in configuration.

## Artifacts

Each run creates `artifacts/<prefix>-<timestamp>/` containing:

```text
session.json
metrics.csv
metrics.jsonl
events.jsonl
chrome-stderr.log
chrome-stdout.log
```

Smoke runs additionally save `hud-smoke.png`. Clean shutdown also writes JSON array mirrors. HUD buttons or `Alt+M` create uninterpreted diagnostic marks.

## Plugins

A plugin is a small object:

```js
{
  id: 'example',
  pageScripts: ['/* optional pre-navigation script */'],
  domains: ['Network'],
  hudSections: [{ id: 'example', title: 'Example', order: 50 }],
  csvFields: [],
  setup(context) {},
  sample(context, currentSample) {
    return { patch: { example: {} }, hud: { example: ['one line'] } };
  },
  cleanup(context) {}
}
```

Custom plugin objects can be included directly in an external config. See `examples/custom-plugin.mjs`.

## External scenarios

```bash
npm run soak -- \
  --url http://localhost:3000 \
  --scenario ./examples/basic-soak.mjs \
  --duration-min 30
```

A scenario provides `phases` or a `phases()` factory. Every phase contains:

```js
{
  name: 'OBSERVE',
  mark: 'OBSERVE',
  durationMs: 60_000,
  action: async (actions, durationMs, context) => {}
}
```

Reusable neutral actions include `click`, `evaluate`, `waitForSelector`, `waitForCondition`, `sleep`, `runCommand`, `runCommandSync`, `stopProcess`, `httpHealth`, and `mark`. Application-specific interaction belongs in the external scenario.
