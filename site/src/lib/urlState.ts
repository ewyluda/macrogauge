/** Pure helpers behind useUrlState — parse/format one query param with a
 *  typed codec, and rewrite a query string. No DOM access here so the
 *  codecs are unit-testable under vitest's node environment; the hook in
 *  useUrlState.ts owns `window`. */
export type Codec<T> = {
  parse: (raw: string) => T | undefined;
  format: (v: T) => string;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const codecs = {
  str: (maxLen = 80): Codec<string> => ({
    parse: (s) => (s.length <= maxLen ? s : undefined),
    format: (v) => v,
  }),
  int: (min = -Infinity, max = Infinity): Codec<number> => ({
    parse: (s) => {
      if (!/^-?\d+$/.test(s)) return undefined;
      const n = Number(s);
      return n >= min && n <= max ? n : undefined;
    },
    format: (v) => String(v),
  }),
  float: (min = -Infinity, max = Infinity): Codec<number> => ({
    parse: (s) => {
      if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
      const n = Number(s);
      return n >= min && n <= max ? n : undefined;
    },
    format: (v) => String(v),
  }),
  bool: (): Codec<boolean> => ({
    parse: (s) => (s === "1" ? true : s === "0" ? false : undefined),
    format: (v) => (v ? "1" : "0"),
  }),
  enumOf: <K extends string>(keys: readonly K[]): Codec<K> => ({
    parse: (s) => (keys.includes(s as K) ? (s as K) : undefined),
    format: (v) => v,
  }),
  /** YYYY-MM */
  month: (): Codec<string> => ({
    parse: (s) => (MONTH.test(s) ? s : undefined),
    format: (v) => v,
  }),
  /** YYYY-MM-DD */
  date: (): Codec<string> => ({
    parse: (s) => (DATE.test(s) ? s : undefined),
    format: (v) => v,
  }),
};

/** Value of `key` in `search` (with or without leading "?"), decoded through
 *  the codec; undefined when absent or invalid. */
export function readParam<T>(search: string, key: string, codec: Codec<T>): T | undefined {
  const raw = new URLSearchParams(search.replace(/^\?/, "")).get(key);
  return raw === null ? undefined : codec.parse(raw);
}

/** New query string (no leading "?", may be empty) with `key` set to `value`
 *  or removed when `value` is null. Other params untouched. */
export function withParam(search: string, key: string, value: string | null): string {
  const p = new URLSearchParams(search.replace(/^\?/, ""));
  if (value === null) p.delete(key);
  else p.set(key, value);
  return p.toString();
}

/** Full relative URL for replaceState: path + "?query" (omitted when empty) + hash. */
export function buildUrl(pathname: string, search: string, hash: string): string {
  return `${pathname}${search ? `?${search}` : ""}${hash}`;
}
