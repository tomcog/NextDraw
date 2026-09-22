export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, options);
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

export const postJSON = <T = any>(path: string, data?: unknown) =>
  api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  });
