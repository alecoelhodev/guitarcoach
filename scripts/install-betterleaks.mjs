#!/usr/bin/env node
/**
 * Downloads the pinned Betterleaks binary into .tooling/bin/ so the pre-commit
 * secret scan works on a fresh clone with no manual install step.
 *
 * Runs from the `prepare` npm script, so `npm install` is all an engineer needs.
 * Deliberately dependency-free: adding an npm package here would drag the
 * lockfile back into the macOS/Alpine `npm ci` hazard described in CLAUDE.md.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.8.1';
const RELEASE = `https://github.com/betterleaks/betterleaks/releases/download/v${VERSION}`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = join(ROOT, '.tooling', 'bin');
const BIN_NAME = process.platform === 'win32' ? 'betterleaks.exe' : 'betterleaks';
const BIN_PATH = join(BIN_DIR, BIN_NAME);

const ARCH = { arm64: 'arm64', x64: 'x64' }[process.arch];
const OS = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];

function log(msg) {
  console.log(`[betterleaks] ${msg}`);
}

/** Returns the installed version, or null if the binary is missing or unrunnable. */
function installedVersion() {
  if (!existsSync(BIN_PATH)) return null;
  try {
    return execFileSync(BIN_PATH, ['version'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  // Docker build stages copy only package.json/package-lock.json, so there is no
  // git repo and nothing to hook: skip rather than bloat the image with a scanner.
  if (!existsSync(join(ROOT, '.git'))) {
    log('not a git checkout, skipping install');
    return;
  }
  // CI installs this explicitly in the security workflow; every other CI job
  // (build, test, deploy) has no use for it.
  if (process.env.CI && !process.env.BETTERLEAKS_FORCE_INSTALL) {
    log('CI detected without BETTERLEAKS_FORCE_INSTALL, skipping install');
    return;
  }
  if (!OS || !ARCH) {
    log(`no prebuilt binary for ${process.platform}/${process.arch} - install betterleaks manually and put it on PATH`);
    return;
  }

  if (installedVersion() === VERSION) return;

  const asset = `betterleaks_${VERSION}_${OS}_${ARCH}.tar.gz`;
  log(`downloading ${asset}`);

  const [archive, checksums] = await Promise.all([
    download(`${RELEASE}/${asset}`),
    download(`${RELEASE}/checksums.txt`).then((b) => b.toString('utf8')),
  ]);

  const expected = checksums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === asset)?.[0];
  if (!expected) throw new Error(`${asset} is missing from checksums.txt`);

  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
  }

  const staging = mkdtempSync(join(tmpdir(), 'betterleaks-'));
  try {
    const tarball = join(staging, asset);
    writeFileSync(tarball, archive);
    execFileSync('tar', ['-xzf', tarball, '-C', staging]);
    mkdirSync(BIN_DIR, { recursive: true });
    renameSync(join(staging, BIN_NAME), BIN_PATH);
    chmodSync(BIN_PATH, 0o755);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  log(`installed ${VERSION} -> ${BIN_PATH}`);
}

main().catch((err) => {
  console.error(`[betterleaks] install failed: ${err.message}`);
  console.error('[betterleaks] the pre-commit secret scan will block commits until this succeeds.');
  process.exitCode = 1;
});
