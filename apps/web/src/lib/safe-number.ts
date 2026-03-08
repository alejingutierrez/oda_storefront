type SafeNumberOptions = {
  fallback: number;
  min?: number;
  max?: number;
};

export function safeNumber(
  value: unknown,
  opts: SafeNumberOptions,
): number {
  const n = Number(value);
  let result = Number.isFinite(n) ? n : opts.fallback;
  if (opts.min !== undefined) result = Math.max(opts.min, result);
  if (opts.max !== undefined) result = Math.min(opts.max, result);
  return result;
}

export function safeInt(
  value: unknown,
  opts: SafeNumberOptions,
): number {
  return Math.floor(safeNumber(value, opts));
}

export function safeEnvNumber(
  envName: string,
  opts: SafeNumberOptions,
): number {
  return safeNumber(process.env[envName], opts);
}

export function safeEnvInt(
  envName: string,
  opts: SafeNumberOptions,
): number {
  return safeInt(process.env[envName], opts);
}
