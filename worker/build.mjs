// Zkopíruje web a data do worker/public – odtud je servíruje Workers Static Assets.
import { cpSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(dirname(fileURLToPath(import.meta.url)), "public");

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of readdirSync(root)) if (f.endsWith(".html")) cpSync(join(root, f), join(out, f));
for (const d of ["assets", "data", "docs"]) cpSync(join(root, d), join(out, d), { recursive: true });
console.log("Web zkopírován do worker/public");
