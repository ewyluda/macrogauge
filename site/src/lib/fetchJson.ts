/** Fetch a JSON artifact, rejecting on a non-2xx response.
 *
 *  `fetch(url).then(r => r.json())` resolves a 404 (the host serves an HTML
 *  not-found page) and only fails inside `r.json()` — a `.catch(() =>
 *  setData(null))` then left three charts on "loading…" forever with no
 *  retry copy (review 2026-09-01 B2). Checking `r.ok` first turns every
 *  non-2xx into a rejection the caller can render as a failure state. */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const r = await fetchImpl(url, init);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}
