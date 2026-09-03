// prebuild: publish the JSON Schemas beside the data so /data can link them
// (static export serves public/ verbatim; schemas/ lives at the repo root).
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
const src = path.resolve("../schemas");
const dst = path.resolve("public/schemas");
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) if (f.endsWith(".schema.json")) { cpSync(path.join(src, f), path.join(dst, f)); n++; }
console.log(`copied ${n} schemas to public/schemas`);
