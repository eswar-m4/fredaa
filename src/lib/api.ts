export function getBaseApiUrl() {
  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
    window.location.port !== "8131"
  ) {
    return `http://${window.location.hostname}:8131`;
  }
  return "";
}

type ApiFetchInit = RequestInit & {
  timeoutMs?: number;
};

export async function apiFetch(path: string, init: ApiFetchInit = {}) {
  const { timeoutMs, signal, ...requestInit } = init;
  const url = `${getBaseApiUrl()}${path}`;

  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(url, {
      credentials: "include",
      signal,
      ...requestInit,
    });
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const abortListener = () => controller.abort();

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortListener, { once: true });
    }
  }

  try {
    return await fetch(url, {
      credentials: "include",
      signal: controller.signal,
      ...requestInit,
    });
  } finally {
    globalThis.clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}

export function isAbortError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; message?: string };
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const message = String(err.message || "").toLowerCase();
  return message.includes("aborted") || message.includes("abort");
}
