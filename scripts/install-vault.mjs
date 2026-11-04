import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const vault = process.env.OBSIDIAN_VAULT;
if (!vault) throw new Error("Set OBSIDIAN_VAULT to the vault folder, e.g. OBSIDIAN_VAULT=~/Notes npm run install:vault");
const target = join(vault, ".obsidian", "plugins", "bases-kanban-toolbox");
await mkdir(target, { recursive: true });
for (const name of ["main.js", "manifest.json", "styles.css"]) await cp(new URL(`../${name}`, import.meta.url), join(target, name));
