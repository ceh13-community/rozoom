/**
 * Storage Class Comparison (#21)
 */

type GenericItem = Record<string, unknown>;

export type StorageClassField = { label: string; left: string; right: string; differs: boolean };
export type StorageClassComparisonResult = {
  leftName: string;
  rightName: string;
  fields: StorageClassField[];
  identical: boolean;
  differenceCount: number;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asString(v: unknown, f = "-"): string {
  return typeof v === "string" ? v : f;
}

export function compareStorageClasses(
  left: GenericItem,
  right: GenericItem,
): StorageClassComparisonResult {
  const lm = asRecord(left.metadata);
  const rm = asRecord(right.metadata);
  const la = asRecord(lm.annotations);
  const ra = asRecord(rm.annotations);
  const lp = asRecord(left.parameters);
  const rp = asRecord(right.parameters);

  const fields: StorageClassField[] = [
    {
      label: "Provisioner",
      left: asString(left.provisioner),
      right: asString(right.provisioner),
      differs: false,
    },
    {
      label: "Reclaim Policy",
      left: asString(left.reclaimPolicy),
      right: asString(right.reclaimPolicy),
      differs: false,
    },
    {
      label: "Volume Binding Mode",
      left: asString(left.volumeBindingMode),
      right: asString(right.volumeBindingMode),
      differs: false,
    },
    {
      label: "Allow Volume Expansion",
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value is boolean/string at runtime from K8s API
      left: String(left.allowVolumeExpansion ?? false),
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value is boolean/string at runtime from K8s API
      right: String(right.allowVolumeExpansion ?? false),
      differs: false,
    },
    {
      label: "Default",
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value is string at runtime from K8s annotation
      left: String(la["storageclass.kubernetes.io/is-default-class"] ?? "false"),
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value is string at runtime from K8s annotation
      right: String(ra["storageclass.kubernetes.io/is-default-class"] ?? "false"),
      differs: false,
    },
  ];

  const allParamKeys = new Set([...Object.keys(lp), ...Object.keys(rp)]);
  for (const key of allParamKeys) {
    fields.push({
      label: `param: ${key}`,
      left: asString(lp[key]),
      right: asString(rp[key]),
      differs: false,
    });
  }

  for (const f of fields) f.differs = f.left !== f.right;
  const differenceCount = fields.filter((f) => f.differs).length;

  return {
    leftName: asString(lm.name),
    rightName: asString(rm.name),
    fields,
    identical: differenceCount === 0,
    differenceCount,
  };
}
