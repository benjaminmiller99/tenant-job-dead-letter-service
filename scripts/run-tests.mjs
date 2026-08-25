import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const args = process.argv.slice(2).filter((arg) => arg !== "--runInBand");
const result = spawnSync(process.execPath, [vitest, "run", ...args], { stdio: "inherit" });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
