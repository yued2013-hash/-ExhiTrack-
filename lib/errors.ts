export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const message =
      typeof obj.message === 'string' && obj.message.length > 0
        ? obj.message
        : JSON.stringify(value);
    const err = new Error(message);
    (err as Error & { cause?: unknown }).cause = value;
    return err;
  }
  return new Error(String(value));
}

export function formatError(value: unknown): string {
  return toError(value).message;
}
