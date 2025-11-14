import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'
import { sanitizeName, extractMeta } from './utils.js'
import { execSync } from 'child_process'

const REMOTE_CACHE_DIR = path.join(process.cwd(), 'data', 'remote_prompts')

function readRemoteSourcesConfig() {
  const cfgPath = path.join(process.cwd(), 'config', 'prompts_sources.json')
  try {
    if (!fs.existsSync(cfgPath)) return []
    const raw = fs.readFileSync(cfgPath, 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    console.warn('[prompts] Failed to read remote prompts config:', e.message)
    return []
  }
}

function readPromptsConfig() {
  const cfgPath = path.join(process.cwd(), 'config', 'prompts_config.json')
  try {
    if (!fs.existsSync(cfgPath)) return {}
    const raw = fs.readFileSync(cfgPath, 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    console.warn('[prompts] Failed to read prompts config:', e.message)
    return {}
  }
}

function ensureGitRepoCloned({ repo, branch = 'main', subdir = '' , name}) {
  // sanitize a directory name per source
  const safeName = sanitizeName((name || repo) + (subdir ? `_${subdir}` : ''))
  const target = path.join(REMOTE_CACHE_DIR, safeName)
  try {
    fs.mkdirSync(REMOTE_CACHE_DIR, { recursive: true })
    if (fs.existsSync(path.join(target, '.git'))) {
      // pull latest
      execSync(`git -C ${target} pull --ff-only`, { stdio: 'inherit' })
    } else if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
      // target exists but not a git repo; remove and clone fresh
      fs.rmSync(target, { recursive: true, force: true })
      execSync(`git clone --depth 1 --branch ${branch} ${repo} ${target}`, { stdio: 'inherit' })
    } else {
      execSync(`git clone --depth 1 --branch ${branch} ${repo} ${target}`, { stdio: 'inherit' })
    }
    const promptDir = subdir ? path.join(target, subdir) : target
    return fs.existsSync(promptDir) ? promptDir : null
  } catch (e) {
    console.warn(`[prompts] Failed to fetch ${repo}: ${e.message}`)
    return null
  }
}

export const dynamicPromptState = {
  loaded: new Map(), // name -> { file, mtime }
  dir: null
};

function resolvePromptsDir() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  if (process.env.PROMPTS_DIR) {
    return path.resolve(process.env.PROMPTS_DIR);
  }

  const candidates = [
    path.join(__dirname, '..', 'data', 'prompts'),
    path.join(__dirname, '..', 'node-mcp', 'data', 'prompts'),
    path.join(process.cwd(), 'data', 'prompts')
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return path.resolve(c); } catch { /* ignore */ }
  }
  return path.resolve(candidates[0]);
}

export async function loadMarkdownPrompts(server, { verbose = true } = {}) {
  const dir = dynamicPromptState.dir || (dynamicPromptState.dir = resolvePromptsDir());
  if (verbose) console.log(`[prompts] Loading from: ${dir}`);
  if (!fs.existsSync(dir)) {
    if (verbose) {
      console.warn(`[prompts] Directory not found: ${dir}`);
      console.warn(`[prompts] Create it and add .md files, or set PROMPTS_DIR to another location.`);
    }
    return { count: 0, dir };
  }
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'));
  let registerCount = 0;
  for (const file of files) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    const baseRaw = path.basename(file, path.extname(file));
    // apply optional prefix to local prompts
    const promptsCfg = readPromptsConfig()
    const envPrefix = process.env.PROMPTS_LOCAL_PREFIX
    const localPrefix = envPrefix || promptsCfg.prefixLocal
    const rawName = localPrefix ? `${localPrefix}_${baseRaw}` : baseRaw
    const promptName = sanitizeName(rawName);
    const already = dynamicPromptState.loaded.get(promptName);
    if (already && already.mtime >= stat.mtimeMs) {
      continue; // unchanged
    }
    const content = fs.readFileSync(full, 'utf8');
    const { title, description } = extractMeta(content, baseRaw);

    try {
      if (!already) {
        server.prompt(
          promptName,
          description || title || promptName,
          {
            context: z.string().describe("Additional context to append").optional()
          },
          async ({ context }) => ({
            messages: [
              { role: 'assistant', content: { type: 'text', text: `You are using the dynamic prompt: ${title}` } },
              { role: 'user', content: { type: 'text', text: content + (context ? `\n\nUser context:\n${context}` : '') } }
            ]
          })
        );
        registerCount++;
      } else if (verbose) {
        console.log(`[prompts] Updated content detected for '${promptName}' (will use old registration until reload tool invoked, depending on server capabilities).`);
      }
      dynamicPromptState.loaded.set(promptName, { file: full, mtime: stat.mtimeMs });
    } catch (e) {
      console.warn(`[prompts] Failed to register prompt '${promptName}':`, e.message);
    }
  }
  return { count: registerCount, total: dynamicPromptState.loaded.size, dir };
}

export function listDynamicPrompts() {
  return Array.from(dynamicPromptState.loaded.entries()).map(([name, info]) => ({ name, file: info.file }));
}

export async function loadMarkdownPromptsFromDir(server, dir, { verbose = true, prefix } = {}) {
  if (verbose) console.log(`[prompts] Loading from arbitrary dir: ${dir}`)
  if (!fs.existsSync(dir)) return { count: 0, dir }
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'))
  let registerCount = 0
  for (const file of files) {
    const full = path.join(dir, file)
    const stat = fs.statSync(full)
    const baseRaw = path.basename(file, path.extname(file))
    const rawName = prefix ? `${prefix}_${baseRaw}` : baseRaw
    const promptName = sanitizeName(rawName)
    const already = dynamicPromptState.loaded.get(promptName)
    if (already && already.mtime >= stat.mtimeMs) continue
    const content = fs.readFileSync(full, 'utf8')
    const { title, description } = extractMeta(content, baseRaw)
    try {
      if (!already) {
        server.prompt(
          promptName,
          description || title || promptName,
          { context: z.string().describe("Additional context to append").optional() },
          async ({ context }) => ({
            messages: [
              { role: 'assistant', content: { type: 'text', text: `You are using the dynamic prompt: ${title}` } },
              { role: 'user', content: { type: 'text', text: content + (context ? `\n\nUser context:\n${context}` : '') } }
            ]
          })
        )
        registerCount++
      } else if (verbose) {
        console.log(`[prompts] Updated content detected for '${promptName}' (will use old registration until reload tool invoked, depending on server capabilities).`)
      }
      dynamicPromptState.loaded.set(promptName, { file: full, mtime: stat.mtimeMs })
    } catch (e) {
      console.warn(`[prompts] Failed to register prompt '${promptName}':`, e.message)
    }
  }
  return { count: registerCount, total: dynamicPromptState.loaded.size, dir }
}

export async function loadAllMarkdownPrompts(server, { verbose = true } = {}) {
  // load local prompts first
  const local = await loadMarkdownPrompts(server, { verbose })
  let totalRemote = 0
  // read remote sources config and fetch each
  const sources = readRemoteSourcesConfig()
  for (const s of sources) {
    const dir = ensureGitRepoCloned(s)
    if (!dir) continue
    const subdir = s.subdir ? path.join(dir) : dir
    const res = await loadMarkdownPromptsFromDir(server, subdir, { verbose, prefix: s.prefix })
    totalRemote += res.count
  }
  return { local: local, remoteCount: totalRemote }
}
