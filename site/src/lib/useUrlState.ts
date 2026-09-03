"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildUrl, readParam, withParam, type Codec } from "./urlState";

/** Write one query param into the address bar without navigation. Removes
 *  the key when `value` is null. No-op during SSR. */
export function setUrlParam(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  const next = buildUrl(pathname, withParam(search, key, value), hash);
  if (next !== pathname + search + hash) window.history.replaceState(window.history.state, "", next);
}

/** Read one query param from the current address bar. Undefined during SSR. */
export function getUrlParam<T>(key: string, codec: Codec<T>): T | undefined {
  if (typeof window === "undefined") return undefined;
  return readParam(window.location.search, key, codec);
}

/** useState whose value is mirrored into `?key=` so every control on the
 *  site is linkable. The static export hydrates with `initial`, then adopts
 *  the URL value on mount (one render later — the page never blocks on it).
 *  Setting the value back to `initial` removes the param so shared links
 *  stay short. Accepts functional updates like useState. */
export function useUrlState<T>(
  key: string,
  initial: T,
  codec: Codec<T>,
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const hydrated = useRef(false);
  const initialStr = codec.format(initial);

  useEffect(() => {
    const fromUrl = getUrlParam(key, codec);
    if (fromUrl !== undefined) setValue(fromUrl);
    hydrated.current = true;
    // codec/initial are stable per call site; re-reading on change is not wanted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated.current) return;
    const s = codec.format(value);
    setUrlParam(key, s === initialStr ? null : s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value, initialStr]);

  const set = useCallback((v: T | ((prev: T) => T)) => setValue(v), []);
  return [value, set];
}
