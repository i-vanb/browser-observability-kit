#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asNumber, parseArgs } from '../../core/utils.mjs';
import { loadScenario } from '../loader.mjs';
import { runSoakScenario } from './engine.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.scenario) {
  console.error('Usage: node src/scenarios/soak/runner.mjs --url <url> --scenario <scenario.mjs> [--config <config.mjs>] [--duration-min 30]');
  process.exit(2);
}
const scenario = await loadScenario(args.scenario);
const durationMin = asNumber(args['duration-min'], 30);
if (durationMin <= 0) throw new Error('--duration-min must be positive');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const result = await runSoakScenario({
  projectRoot,
  scenario,
  configPath: args.config ? path.resolve(args.config) : scenario.configPath,
  url: args.url,
  durationMin,
  artifactRoot: path.resolve(args['artifact-dir'] ?? path.join(projectRoot, 'artifacts'))
});
console.log(`Scenario artifacts: ${result.artifactDir}`);
console.log(`Phases: ${result.phases.map((phase) => `${phase.name}:${phase.status}`).join(', ')}`);
if (result.stopReason !== 'completed') process.exitCode = 1;
