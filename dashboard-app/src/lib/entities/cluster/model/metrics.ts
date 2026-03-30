export type NodesChecksBadge = {
  className: string;
  description?: string;
  status: string;
  count: {
    ready: number;
    total: number;
    pressures?: {
      diskPressure: number;
      memoryPressure: number;
      pidPressure: number;
      networkUnavailable: number;
    };
  };
};

export type Conditions = {
  count: {
    ready: number;
    pressures: {
      diskPressure: number;
      memoryPressure: number;
      pidPressure: number;
      networkUnavailable: number;
    };
  };
};
