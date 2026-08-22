import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findExecutable } from './utils.mjs';

function parseProcMemory(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const smaps = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const value = (text, key) => Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
    return {
      rssMb: value(status, 'VmRSS') / 1024,
      privateMb: (value(smaps, 'Private_Clean') + value(smaps, 'Private_Dirty')) / 1024,
      anonymousMb: value(smaps, 'Anonymous') / 1024
    };
  } catch {
    return { rssMb: 0, privateMb: 0, anonymousMb: 0 };
  }
}

export class ChromeProcessSampler {
  constructor() {
    this.previousCpu = new Map();
    this.previousAt = performance.now();
  }

  async sample(browserCdp) {
    const now = performance.now();
    const elapsed = Math.max(0.001, (now - this.previousAt) / 1000);
    this.previousAt = now;
    const info = await browserCdp.send('SystemInfo.getProcessInfo');
    const groups = {
      renderer: { cpu: 0, rssMb: 0, privateMb: 0, anonymousMb: 0, count: 0, hasCpuDelta: false },
      gpu: { cpu: 0, rssMb: 0, privateMb: 0, anonymousMb: 0, count: 0, hasCpuDelta: false }
    };
    for (const item of info.processInfo ?? []) {
      const key = item.type === 'renderer' ? 'renderer' : item.type === 'GPU' ? 'gpu' : null;
      if (!key) continue;
      const group = groups[key];
      const pid = Number(item.id);
      const cpuKey = `${key}:${pid}`;
      const previous = this.previousCpu.get(cpuKey);
      this.previousCpu.set(cpuKey, Number(item.cpuTime));
      if (previous !== undefined) {
        group.cpu += Math.max(0, (Number(item.cpuTime) - previous) / elapsed * 100);
        group.hasCpuDelta = true;
      }
      const memory = parseProcMemory(pid);
      group.rssMb += memory.rssMb;
      group.privateMb += memory.privateMb;
      group.anonymousMb += memory.anonymousMb;
      group.count++;
    }
    if (!groups.renderer.hasCpuDelta) groups.renderer.cpu = null;
    if (!groups.gpu.hasCpuDelta) groups.gpu.cpu = null;
    return groups;
  }
}

export function detectPhysicalGpuTelemetry() {
  const tools = {
    nvidiaSmi: findExecutable('nvidia-smi'),
    intelGpuTop: findExecutable('intel_gpu_top'),
    radeontop: findExecutable('radeontop'),
    lspci: findExecutable('lspci')
  };
  const adapters = tools.lspci
    ? spawnSync(tools.lspci, ['-nn'], { encoding: 'utf8' }).stdout.split('\n').filter((line) => /VGA|3D controller|Display controller/i.test(line))
    : [];

  if (tools.nvidiaSmi) {
    return {
      available: true,
      provider: 'nvidia-smi',
      tools,
      adapters,
      sample() {
        const result = spawnSync(tools.nvidiaSmi, [
          '--query-gpu=utilization.gpu,utilization.decoder,memory.used,memory.total',
          '--format=csv,noheader,nounits'
        ], { encoding: 'utf8', timeout: 1500 });
        if (result.status !== 0) return { available: false, provider: 'nvidia-smi', error: result.stderr.trim() };
        const [gpuUtil, videoDecodeUtil, memoryUsedMb, memoryTotalMb] = result.stdout.trim().split(',').map((part) => Number(part.trim()));
        return { available: true, provider: 'nvidia-smi', gpuUtil, videoDecodeUtil, memoryUsedMb, memoryTotalMb };
      }
    };
  }

  let busyFile = null;
  try {
    for (const entry of fs.readdirSync('/sys/class/drm').filter((name) => /^card\d+$/.test(name))) {
      const candidate = path.join('/sys/class/drm', entry, 'device', 'gpu_busy_percent');
      if (fs.existsSync(candidate)) { busyFile = candidate; break; }
    }
  } catch {}

  if (busyFile) {
    const deviceRoot = path.dirname(busyFile);
    return {
      available: true,
      provider: 'drm-sysfs',
      tools,
      adapters,
      sample() {
        try {
          const used = path.join(deviceRoot, 'mem_info_vram_used');
          const total = path.join(deviceRoot, 'mem_info_vram_total');
          return {
            available: true,
            provider: 'drm-sysfs',
            gpuUtil: Number(fs.readFileSync(busyFile, 'utf8').trim()),
            videoDecodeUtil: null,
            memoryUsedMb: fs.existsSync(used) ? Number(fs.readFileSync(used, 'utf8').trim()) / 1024 / 1024 : null,
            memoryTotalMb: fs.existsSync(total) ? Number(fs.readFileSync(total, 'utf8').trim()) / 1024 / 1024 : null
          };
        } catch (error) {
          return { available: false, provider: 'drm-sysfs', error: error.message };
        }
      }
    };
  }

  return {
    available: false,
    provider: null,
    tools,
    adapters,
    reason: 'No nvidia-smi and no readable DRM gpu_busy_percent. Chrome GPU-process metrics remain available but are not physical GPU utilization.',
    sample: () => ({ available: false, provider: null })
  };
}
