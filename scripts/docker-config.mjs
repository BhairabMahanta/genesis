#!/usr/bin/env node
/**
 * Keeps Docker's CLI config readable.
 *
 * Docker Desktop on Windows (seen with 4.92) rewrites ~/.docker/config.json with a
 * UTF-8 byte-order mark about 20 seconds after it starts. Docker cannot parse a BOM:
 * the CLI warns "invalid character 'ï'" and falls back to the default context, and
 * the next Docker Desktop start fails with "parsing docker CLI config file". Nothing
 * in this repository writes that file; this only removes the three BOM bytes again.
 *
 *   pnpm docker:fix     (run before starting Docker Desktop by hand)
 *
 * `scripts/dev.mjs` calls it automatically, so `pnpm dev` heals the file on its own.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function dockerConfigPath() {
  return path.join(process.env.DOCKER_CONFIG ?? path.join(os.homedir(), ".docker"), "config.json");
}

/** Removes a leading UTF-8 BOM from Docker's config. Returns true when it changed the file. */
export function repairDockerConfig() {
  const file = dockerConfigPath();
  try {
    if (!existsSync(file)) return false;
    const bytes = readFileSync(file);
    if (bytes.length < 3 || bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) return false;
    const backup = `${file}.bom-backup`;
    if (!existsSync(backup)) copyFileSync(file, backup);
    writeFileSync(file, bytes.subarray(3));
    return true;
  } catch {
    // Locked or unreadable right now: leave it; the next check retries.
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = dockerConfigPath();
  console.log(
    repairDockerConfig()
      ? `[docker-config] removed the UTF-8 BOM from ${file}`
      : `[docker-config] ${file} is fine (no BOM)`,
  );
}
