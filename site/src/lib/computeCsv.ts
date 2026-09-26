import type { CsvRow } from "./csv";

type IndexHistory = {
  dates: string[];
  index: (number | null)[];
  members: number[];
};

/** /compute's composite-index CSV: the token and GPU-hour histories JOINED ON
 *  DATE. The two indexes have their own date grids (different first collects,
 *  different weekend coverage), so pairing them by array position would put a
 *  GPU value on the wrong day. One row per date in either history, sorted; a
 *  date one index lacks gets empty cells for it. */
export function computeIndexRows(token: IndexHistory, gpu: IndexHistory): CsvRow[] {
  const byDate = new Map<string, CsvRow>();
  const put = (h: IndexHistory, prefix: "token" | "gpu") => {
    h.dates.forEach((d, i) => {
      const row = byDate.get(d) ?? {
        date: d, token_index: null, token_members: null, gpu_index: null, gpu_members: null,
      };
      row[`${prefix}_index`] = h.index[i] ?? null;
      row[`${prefix}_members`] = h.members[i] ?? null;
      byDate.set(d, row);
    });
  };
  put(token, "token");
  put(gpu, "gpu");
  return [...byDate.keys()].sort().map((d) => byDate.get(d)!);
}
