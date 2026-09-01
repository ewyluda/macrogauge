"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "./fetchJson";

export type JsonState<T> = { data: T | null; failed: boolean };

/** Load a static JSON artifact at runtime with a real failure state.
 *
 *  Resolves `{data}` on success and `{failed: true}` on any non-2xx or parse
 *  error, so a page can say "unavailable — reload to retry" instead of
 *  showing "loading…" forever. Aborts the in-flight request on unmount or
 *  when `url` changes, and never sets state after abort. */
export function useJson<T>(url: string): JsonState<T> {
  const [state, setState] = useState<JsonState<T>>({ data: null, failed: false });

  useEffect(() => {
    const ctl = new AbortController();
    setState({ data: null, failed: false });
    fetchJson<T>(url, { signal: ctl.signal })
      .then((data) => setState({ data, failed: false }))
      .catch(() => {
        if (!ctl.signal.aborted) setState({ data: null, failed: true });
      });
    return () => ctl.abort();
  }, [url]);

  return state;
}
