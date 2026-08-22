import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function loadScenario(scenarioPath) {
  if (!scenarioPath) throw new Error('--scenario must point to a scenario.mjs file');
  const absolutePath = path.resolve(scenarioPath);
  const module = await import(pathToFileURL(absolutePath).href);
  const scenario = module.default;
  if (!scenario || typeof scenario !== 'object') throw new Error(`Scenario must default-export an object: ${absolutePath}`);
  if (typeof scenario.phases !== 'function' && !Array.isArray(scenario.phases)) throw new Error(`Scenario must define phases or phases(): ${absolutePath}`);
  let configPath = scenario.config;
  if (configPath instanceof URL) configPath = fileURLToPath(configPath);
  else if (configPath && !path.isAbsolute(configPath)) configPath = path.resolve(path.dirname(absolutePath), configPath);
  return {
    ...scenario,
    id: scenario.id ?? path.basename(absolutePath, path.extname(absolutePath)),
    scenarioPath: absolutePath,
    configPath
  };
}
