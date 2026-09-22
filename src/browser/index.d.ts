export type BrowserMetricsSnapshot = {
  timestamp: number;
  eventLoopLagMs: number;
  longTasksSupported: boolean;
  longTasks10s: number | null;
  longestTaskMs10s: number | null;
  rafCallbacksPerSecond: number;
  canvasDrawImageCallsPerSecond: number;
  domElements: number;
};

export type BrowserObserver = {
  start(): BrowserObserver;
  snapshot(): BrowserMetricsSnapshot;
  subscribe(subscriber: (snapshot: BrowserMetricsSnapshot) => void): () => void;
  destroy(): void;
};

export type BrowserObserverOptions = {
  sampleIntervalMs?: number;
  target?: Window;
};

export function createBrowserObserver(options?: BrowserObserverOptions): BrowserObserver;
export function start(options?: BrowserObserverOptions): BrowserObserver;
