export default {
  id: 'video-observability',
  artifactPrefix: 'video-observability',
  plugins: [
    ['browser-performance'],
    ['memory'],
    ['dom'],
    ['network', {
      groups: {
        media: /\.(?:m3u8|mpd|ts|m4s|mp4)(?:$|\?)/i
      }
    }],
    ['video', {
      targets: [
        { id: 'main', label: 'Main video', selector: 'video', index: 0 }
      ]
    }],
    ['canvas'],
    ['media-objects'],
    ['hls-js']
  ]
};
