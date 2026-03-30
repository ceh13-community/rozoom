export function parseCpu(cpu: string): number {
  if (cpu.endsWith("m")) return parseInt(cpu) / 1000;
  return parseInt(cpu);
}

export function parseMemory(mem: string): number {
  if (mem === "0" || !mem) return 0;
  if (mem.endsWith("Ki")) return Math.round(parseInt(mem) / 1024);
  if (mem.endsWith("Mi")) return Math.round(parseInt(mem));
  if (mem.endsWith("Gi")) return Math.round(parseInt(mem) * 1024);

  return Math.round(parseInt(mem));
}

export function parseDisk(disk: string): number {
  return parseMemory(disk);
}
