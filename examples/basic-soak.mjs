export default {
  id: 'basic-soak',
  config: new URL('./basic.config.mjs', import.meta.url),
  artifactPrefix: 'browser-soak',
  phases({ durationMs }) {
    const warmupMs = Math.min(30_000, Math.floor(durationMs * 0.2));
    return [
      {
        name: 'WARMUP',
        mark: 'WARMUP',
        durationMs: warmupMs,
        action: ({ sleep }, phaseDurationMs) => sleep(phaseDurationMs)
      },
      {
        name: 'OBSERVE',
        mark: 'OBSERVE',
        durationMs: Math.max(0, durationMs - warmupMs),
        action: ({ sleep }, phaseDurationMs) => sleep(phaseDurationMs)
      }
    ];
  }
};
