#!/usr/bin/env node
import path from 'node:path';
import { runCollector } from '../core/collector.mjs';
import { loadConfig } from '../config/loader.mjs';
import { asNumber, parseArgs } from '../core/utils.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.config) {
  console.error('Usage: node src/cli/run.mjs --url <url> --config <absolute-or-relative-config.mjs> [--artifact-dir path] [--artifact-prefix name] [--smoke]');
  process.exit(2);
}
const config = await loadConfig(args.config);
let active = null;
const stop = (signal) => { void active?.shutdown(signal, 0); };
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

try {
  active = await runCollector({
    url: args.url,
    config,
    artifactRoot: path.resolve(args['artifact-dir'] ?? 'artifacts'),
    artifactPrefix: args['artifact-prefix'] ?? config.artifactPrefix,
    sampleIntervalMs: asNumber(args['sample-ms'], 1000),
    smoke: Boolean(args.smoke),
    smokeDurationMs: asNumber(args['smoke-ms'], 3500),
    headless: Boolean(args.headless),
    chromeBin: args['chrome-bin'],
    onReady(ready) {
      console.log('HUD ready. Use the browser normally.');
      console.log(`URL: ${ready.url}`);
      console.log(`Config: ${config.configPath}`);
      console.log(`Artifacts: ${ready.artifactDir}`);
      console.log('Stop: Ctrl+C');
      console.log(`BROWSER_OBSERVABILITY_READY ${JSON.stringify({ cdpPort: ready.cdpPort, artifactDir: ready.artifactDir, url: ready.url, config: config.configPath })}`);
    }
  });
  const result = await active.stopped;
  console.log(`Diagnostics saved: ${result.artifactDir}`);
  process.exitCode = result.exitCode;
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
