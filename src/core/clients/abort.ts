// A tiny AbortSignal-compatible interface so we don't depend on DOM types.
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export function isAborted(signal?: AbortSignalLike | null): boolean {
  return !!signal?.aborted;
}

export class AbortError extends Error {
  constructor(message = "Aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export function throwIfAborted(signal?: AbortSignalLike | null): void {
  if (signal?.aborted) throw new AbortError();
}
