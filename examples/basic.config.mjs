export default {
  id: 'basic',
  artifactPrefix: 'browser-observability',
  hud: {
    title: 'BROWSER OBSERVABILITY',
    marks: ['BASELINE', 'ACTION', 'RECOVERY', 'CUSTOM']
  },
  plugins: [
    ['browser-performance'],
    ['memory'],
    ['dom'],
    ['network']
  ]
};
