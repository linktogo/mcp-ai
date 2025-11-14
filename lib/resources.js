import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'
import { dynamicPromptState } from './prompts.js'
import { sanitizeName, guessResourceType } from './utils.js'

export const dynamicResourceState = {
  loaded: new Map(), // name -> { file, mtime, type }
  dir: null
};

function resolveResourcesDir() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  if (process.env.RESOURCES_DIR) return path.resolve(process.env.RESOURCES_DIR);
  const candidates = [
    path.join(__dirname, '..', 'data', 'ressources'),
    path.join(__dirname, '..', 'data', 'resources'),
    path.join(__dirname, '..', 'node-mcp', 'data', 'ressources'),
    path.join(__dirname, '..', 'node-mcp', 'data', 'resources'),
    path.join(process.cwd(), 'data', 'ressources'),
    path.join(process.cwd(), 'data', 'resources')
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return path.resolve(c); } catch { /* ignore */ }
  }
  return path.resolve(candidates[0]);
}

export async function loadResources({ verbose = true } = {}) {
  const dir = dynamicResourceState.dir || (dynamicResourceState.dir = resolveResourcesDir());
  if (verbose) console.log(`[resources] Loading from: ${dir}`);
  if (!fs.existsSync(dir)) {
    if (verbose) {
      console.warn(`[resources] Directory not found: ${dir}`);
      console.warn('[resources] Create it and add .md/.txt/.json files or set RESOURCES_DIR.');
    }
    return { count: 0, total: 0, dir };
  }
  const files = fs.readdirSync(dir).filter(f => /\.(md|txt|json)$/i.test(f));
  let newCount = 0;
  for (const file of files) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    const baseRaw = path.basename(file, path.extname(file));
    const name = sanitizeName(baseRaw);
    const already = dynamicResourceState.loaded.get(name);
    if (already && already.mtime >= stat.mtimeMs) continue; // unchanged
    const type = guessResourceType(full);
    dynamicResourceState.loaded.set(name, { file: full, mtime: stat.mtimeMs, type });
    if (!already) newCount++;
  }
  return { count: newCount, total: dynamicResourceState.loaded.size, dir };
}

export function listResources() {
  return Array.from(dynamicResourceState.loaded.entries()).map(([name, info]) => ({ name, file: info.file, type: info.type }));
}

export function getResourceContent(name) {
  const meta = dynamicResourceState.loaded.get(name);
  if (!meta) throw new Error(`Unknown resource '${name}'.`);
  const raw = fs.readFileSync(meta.file, 'utf8');
  if (meta.type === 'json') {
    try { return { meta, content: JSON.stringify(JSON.parse(raw), null, 2) }; } catch { /* fallthrough */ }
  }
  return { meta, content: raw };
}

export function shouldExportResourcesAsPrompts() {
  const val = (process.env.EXPORT_RESOURCES_AS_PROMPTS || 'true').toLowerCase();
  return !(val === '0' || val === 'false' || val === 'no');
}

export function resourcePromptName(baseName) {
  return `resource_${baseName}`.substring(0, 70);
}

export function registerResourcesAsPrompts(server, { verbose = true } = {}) {
  if (!shouldExportResourcesAsPrompts()) {
    if (verbose) console.log('[resources->prompts] Export disabled via EXPORT_RESOURCES_AS_PROMPTS');
    return { exported: 0 };
  }
  let count = 0;
  for (const [name, info] of dynamicResourceState.loaded.entries()) {
    const promptName = resourcePromptName(name);
    if (dynamicPromptState.loaded.has(promptName) || dynamicPromptState.loaded.get(promptName)) {
      // Skip if a prompt with that name is already declared
      continue;
    }
    try {
      const raw = fs.readFileSync(info.file, 'utf8');
      const preview = raw.slice(0, 120).replace(/\s+/g, ' ').trim();
      // Register a minimal prompt that injects the resource content
      server.prompt(
        promptName,
        `Auto-exported resource (${info.type}) from ${path.basename(info.file)}`,
        {
          context: z.string().describe('Optional extra context to append').optional()
        },
        async ({ context }) => ({
          messages: [
            { role: 'assistant', content: { type: 'text', text: `You are using the exported resource '${name}'. Preview: ${preview}` } },
            { role: 'user', content: { type: 'text', text: raw + (context ? `\n\nExtra context:\n${context}` : '') } }
          ]
        })
      );
      // Track in prompt state (without re-reading mtime here)
      dynamicPromptState.loaded.set(promptName, { file: info.file, mtime: info.mtime });
      count++;
    } catch (e) {
      if (verbose) console.warn(`[resources->prompts] Failed to export '${name}':`, e.message);
    }
  }
  if (verbose) console.log(`[resources->prompts] Exported ${count} resource(s) as prompts.`);
  return { exported: count };
}
