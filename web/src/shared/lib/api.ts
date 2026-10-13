export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, options);
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  // The answer goes with the error, for callers that need more than its message (a refusal's reason).
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { body });
  return body as T;
}

export const postJSON = <T = any>(path: string, data?: unknown, method = "POST") =>
  api<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  });
