import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlugin } from './plugin-registry.mjs';

export async function loadConfig(configPath) {
  if (!configPath) throw new Error('--config must point to an observability.config.mjs file');
  const absolutePath = path.resolve(configPath);
  const module = await import(pathToFileURL(absolutePath).href);
  const source = module.default;
  if (!source || typeof source !== 'object') throw new Error(`Config must default-export an object: ${absolutePath}`);
  if (!Array.isArray(source.plugins) || source.plugins.length === 0) throw new Error(`Config must define a non-empty plugins array: ${absolutePath}`);
  return {
    ...source,
    id: source.id ?? path.basename(absolutePath, path.extname(absolutePath)),
    artifactPrefix: source.artifactPrefix ?? 'browser-observability',
    hud: source.hud ?? { title: 'BROWSER OBSERVABILITY', marks: ['BASELINE', 'ACTION', 'RECOVERY', 'CUSTOM'] },
    plugins: source.plugins.map(createPlugin),
    configPath: absolutePath
  };
}
