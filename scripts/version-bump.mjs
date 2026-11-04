import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";

const version = process.env.npm_package_version;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("npm_package_version must be an unprefixed semantic version");
}

const manifestUrl = new URL("../manifest.json", import.meta.url);
const versionsUrl = new URL("../versions.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const versions = JSON.parse(await readFile(versionsUrl, "utf8"));

manifest.version = version;
versions[version] = manifest.minAppVersion;

await Promise.all([
  writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(versionsUrl, `${JSON.stringify(versions, null, 2)}\n`),
]);
