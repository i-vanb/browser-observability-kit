export type ProcessMetrics = {
  cpu: number | null;
  rssMb: number | null;
  privateMb: number | null;
  anonymousMb: number | null;
  count: number;
};

export type PhysicalGpuMetrics =
  | {
      available: true;
      provider: string;
      gpuUtil: number | null;
      videoDecodeUtil: number | null;
      memoryUsedMb: number | null;
      memoryTotalMb: number | null;
    }
  | {
      available: false;
      provider: string | null;
      reason: string;
    };

export type ManagedMetricsSnapshot = {
  timestamp: number;
  processes: {
    renderer: ProcessMetrics;
    gpu: ProcessMetrics;
  };
  responsiveness: {
    eventLoopLagMs: number | null;
    longTasksSupported: boolean;
    longTasks10s: number | null;
    maxLongTaskMs10s: number | null;
  };
  page: {
    heapUsedMb: number | null;
    heapTotalMb: number | null;
    documents: number | null;
    nodes: number | null;
    listeners: number | null;
  };
  physicalGpu: PhysicalGpuMetrics;
};

export type ManagedObserverOptions = {
  url: string;
  chromeBin?: string;
  sampleIntervalMs?: number;
  readyExpression?: string;
  pageReadyTimeoutMs?: number;
  allowedOrigins?: string[];
  onDiagnostic?: (event: { type: string; detail: Record<string, unknown>; timestamp: number }) => void;
};

export type ManagedObserver = {
  start(): Promise<ManagedObserver>;
  snapshot(): Promise<ManagedMetricsSnapshot>;
  subscribe(subscriber: (snapshot: ManagedMetricsSnapshot) => void): () => void;
  /** Evaluate only runner-owned, static expressions. Never pass user input through. */
  evaluate(expression: string): Promise<unknown>;
  environment(): {
    browser: string | null;
    chromeSandbox: boolean;
    targetOrigin: string;
    physicalGpu: {
      available: boolean;
      provider: string | null;
      reason: string | null;
      adapters: string[];
    };
  };
  destroy(): Promise<void>;
};

export function createManagedObserver(options: ManagedObserverOptions): ManagedObserver;
