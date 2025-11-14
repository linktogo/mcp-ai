#!/usr/bin/env node
"use strict";

// Script to collect prompt files into a small npm package and optionally publish it.
// Usage:
//   node scripts/publish_prompts.js            -> build and npm publish
//   node scripts/publish_prompts.js --build-only -> only build the package under dist/
//   DRY_RUN=1 node scripts/publish_prompts.js   -> don't run npm publish, only show actions
// Environment overrides:
//   PROMPTS_PACKAGE_NAME  - package name for prompts (default: <pkg.name>-prompts)
//   PROMPTS_PACKAGE_VERSION - version (default: pkg.version)
//   NPM_PUBLISH_ACCESS - access flag for npm publish (e.g. public)

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";

const root = process.cwd();
const pkgPath = path.join(root, "package.json");

function log(...args) {
  console.log("[publish_prompts]", ...args);
}

function usage() {
  console.log("Usage: node scripts/publish_prompts.js [--build-only]");
  process.exit(1);
}

const args = process.argv.slice(2);
const buildOnly = args.includes("--build-only");

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch (e) {
    return false;
  }
}

async function rimraf(p) {
  if (!(await exists(p))) return;
  await fsp.rm(p, { recursive: true, force: true });
}

async function copyRecursive(src, dest) {
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    const entries = await fsp.readdir(src);
    for (const entry of entries) {
      await copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else if (st.isFile()) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
  }
}

async function main() {
  if (!fs.existsSync(pkgPath)) {
    console.error("Cannot find package.json in working directory.");
    process.exit(2);
  }

  const rootPkg = JSON.parse(await fsp.readFile(pkgPath, "utf8"));

  const defaultName = `${rootPkg.name || "lk-ai"}-prompts`;
  const name = process.env.PROMPTS_PACKAGE_NAME || defaultName;
  const version = process.env.PROMPTS_PACKAGE_VERSION || rootPkg.version || "0.0.0"
    ;
  const access = process.env.NPM_PUBLISH_ACCESS || "public";
  const dryRun = !!process.env.DRY_RUN;

  const outDir = path.join(root, "dist", name.replace(/[^a-zA-Z0-9._-]/g, "-"));

  log(`Building prompts package ${name}@${version} -> ${outDir}`);

  // Clean
  await rimraf(outDir);
  await fsp.mkdir(outDir, { recursive: true });

  // Which prompt files to include? by default include data/chatmodes and data/prompts and data/collections
  const candidates = [
    path.join(root, "data", "chatmodes"),
    path.join(root, "data", "prompts"),
    path.join(root, "data", "remote_prompts"),
    path.join(root, "data", "collections"),
  ];

  let added = 0;
  for (const src of candidates) {
    if (await exists(src)) {
      const dest = path.join(outDir, path.relative(root, src));
      log(`Copying ${src} -> ${dest}`);
      await copyRecursive(src, dest);
      added++;
    }
  }

  // If a prompts_sources.json exists, clone or pull the configured remote prompt repositories
  const promptsSourcesPath = path.join(root, "config", "prompts_sources.json");
  if (await exists(promptsSourcesPath)) {
    try {
      const raw = await fsp.readFile(promptsSourcesPath, "utf8");
      const sources = JSON.parse(raw);
      if (Array.isArray(sources) && sources.length > 0) {
        const remoteBase = path.join(outDir, "data", "remote_prompts");
        await fsp.mkdir(remoteBase, { recursive: true });
        for (const srcEntry of sources) {
          // support simple string entries or objects { repo, name, branch }
          let repo = null;
          let name = null;
          let branch = null;
          if (typeof srcEntry === "string") {
            repo = srcEntry;
          } else if (typeof srcEntry === "object" && srcEntry !== null) {
            repo = srcEntry.repo || srcEntry.url || srcEntry.git || null;
            name = srcEntry.name || srcEntry.prefix || null;
            branch = srcEntry.branch || null;
          }
          if (!repo) continue;
          // sanitize a name
          const safe = (name || repo)
            .replace(/[^a-zA-Z0-9._-]/g, "-")
            .replace(/^-+|-+$/g, "");
          const dest = path.join(remoteBase, safe);
          if (await exists(dest)) {
            log(`Updating remote prompts ${repo} -> ${dest}`);
            try {
              const pullArgs = ["-C", dest, "pull"];
              if (branch) {
                // try to fetch branch then checkout
                spawnSync("git", ["-C", dest, "fetch", "origin", branch], { stdio: "inherit" });
                spawnSync("git", ["-C", dest, "checkout", branch], { stdio: "inherit" });
                spawnSync("git", pullArgs, { stdio: "inherit" });
              } else {
                spawnSync("git", pullArgs, { stdio: "inherit" });
              }
            } catch (e) {
              log("Failed to pull", repo, e.message || e);
            }
          } else {
            log(`Cloning remote prompts ${repo} -> ${dest}`);
            try {
              const cloneArgs = ["clone", "--depth", "1"];
              if (branch) {
                cloneArgs.push("--branch", branch);
              }
              cloneArgs.push(repo, dest);
              const r = spawnSync("git", cloneArgs, { stdio: "inherit" });
              if (r.error) {
                log("git clone failed:", r.error.message || r.error);
              }
            } catch (e) {
              log("Failed to clone", repo, e.message || e);
            }
          }
        }
      }
    } catch (e) {
      log("Failed to read or parse prompts_sources.json:", e.message || e);
    }
    // ensure remote prompts are counted as added
    const remoteOut = path.join(outDir, "data", "remote_prompts");
    if (await exists(remoteOut)) added++;
  }

  if (added === 0) {
    log("No prompt folders found (expected e.g. data/chatmodes). Nothing copied.");
  }

  // Write a package.json for the prompts package
  const promptsPkg = {
    name,
    version,
    description: process.env.PROMPTS_PACKAGE_DESCRIPTION || `${rootPkg.description || "Prompts"} (prompts package)` ,
    license: rootPkg.license || "UNLICENSED",
    keywords: ["prompts", "mcp", "chatmodes"],
    type: "module",
    main: "index.js",
    files: ["data/", "index.js"],
    repository: rootPkg.repository || undefined,
    author: rootPkg.author || undefined,
    homepage: rootPkg.homepage || undefined,
  };

  const promptsPkgPath = path.join(outDir, "package.json");
  await fsp.writeFile(promptsPkgPath, JSON.stringify(promptsPkg, null, 2), "utf8");

  // Minimal README
  const readme = `# ${name}\n\nThis package contains prompt files extracted from the main repository.\n\nInstall with:\n\n\tnpm install ${name}\n\nFiles are located under the \`data/\` directory of the package.\n`;
  await fsp.writeFile(path.join(outDir, "README.md"), readme, "utf8");

  // Create an index.js that exports all prompt files under data/
  const indexJs = `import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const dataDir = fileURLToPath(new URL('./data/', import.meta.url));
function walk(dir, base = '') {
  const out = {};
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = ent.name;
    if (name === '.' || name === '..') continue;
    const p = path.join(dir, name);
    const rel = base ? \`\${base}/\${name}\` : name;
    if (ent.isDirectory()) {
      Object.assign(out, walk(p, rel));
    } else if (ent.isFile()) {
      const key = rel.replace(/\\.md$/i, '');
      out[key] = fs.readFileSync(p, 'utf8');
    }
  }
  return out;
}
const prompts = walk(dataDir);
export default prompts;
export function getPrompt(name) { return prompts[name]; }
export function listPrompts() { return Object.keys(prompts); }
`;
  await fsp.writeFile(path.join(outDir, "index.js"), indexJs, "utf8");

  log("Build complete.");

  if (buildOnly || dryRun) {
    log("Build-only or DRY_RUN set — skipping npm publish.");
    log(`Package ready at ${outDir}`);
    return;
  }

  // Run npm publish
  log("Running npm publish...");
  const publishArgs = ["publish"];
  if (access) publishArgs.push("--access", access);

  const res = spawnSync("npm", publishArgs, {
    cwd: outDir,
    stdio: "inherit",
    env: { ...process.env },
  });

  if (res.error) {
    console.error("Failed to run npm publish:", res.error);
    process.exit(3);
  }

  if (res.status !== 0) {
    console.error("npm publish failed with code", res.status);
    process.exit(res.status || 4);
  }

  log("npm publish completed successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(10);
});
