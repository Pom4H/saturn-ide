let key = "";
export const setKey = (value: string) => { key = value; };
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, body === undefined ? { signal } : { method: "POST", signal, headers: { "Content-Type": "application/json", "X-Saturn-Key": key }, body: JSON.stringify(body) });
  if (!response.ok) { const error = await response.json() as { error?: string }; throw new Error(error.error ?? `HTTP ${response.status}`); }
  return response.json() as Promise<T>;
}
