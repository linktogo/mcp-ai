import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

// ------------------------------
// Dynamic Markdown Prompt Loader
// ------------------------------
// This mechanism scans a prompts directory (default: ../data/prompts relative to this file)
// and registers each .md file as an MCP prompt. The prompt name is derived from the filename.
// The first level-1 heading (# Title) becomes the description; fallback to filename.
// Environment override: PROMPTS_DIR can point to another directory.

const dynamicPromptState = {
  loaded: new Map(), // name -> { file, mtime }
  dir: null
};

// ------------------------------
// Dynamic Resources Loader (data/ressources or data/resources)
// ------------------------------
// Loads auxiliary resource files (.md, .txt, .json) and exposes them via MCP tools.
// Environment override: RESOURCES_DIR
const dynamicResourceState = {
  loaded: new Map(), // name -> { file, mtime, type }
  dir: null
};

// ------------------------------
// Dynamic Resources Loader (data/ressources or data/resources)
// ------------------------------
// Loads auxiliary resource files (markdown, text, json) and exposes them via MCP tools.
// Environment override: RESOURCES_DIR
// Removed duplicate dynamicResourceState declaration

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

function guessResourceType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.md') return 'markdown';
  if (ext === '.json') return 'json';
  if (ext === '.txt') return 'text';
  return 'unknown';
}

async function loadResources({ verbose = true } = {}) {
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

function listResources() {
  return Array.from(dynamicResourceState.loaded.entries()).map(([name, info]) => ({ name, file: info.file, type: info.type }));
}

function getResourceContent(name) {
  const meta = dynamicResourceState.loaded.get(name);
  if (!meta) throw new Error(`Unknown resource '${name}'.`);
  const raw = fs.readFileSync(meta.file, 'utf8');
  if (meta.type === 'json') {
    try { return { meta, content: JSON.stringify(JSON.parse(raw), null, 2) }; } catch { /* fallthrough */ }
  }
  return { meta, content: raw };
}

// ------------------------------
// Export Resources as Prompts (optional)
// ------------------------------
function shouldExportResourcesAsPrompts() {
  const val = (process.env.EXPORT_RESOURCES_AS_PROMPTS || 'true').toLowerCase();
  return !(val === '0' || val === 'false' || val === 'no');
}

function resourcePromptName(baseName) {
  return `resource_${baseName}`.substring(0, 70);
}

function registerResourcesAsPrompts(server, { verbose = true } = {}) {
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


function sanitizeName(base) {
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 64);
}

function extractMeta(markdown, fallbackName) {
  // Simple extraction of first H1
  const headingMatch = markdown.match(/^#\s+(.+)/m);
  const title = headingMatch ? headingMatch[1].trim() : fallbackName;
  // Optional: first paragraph after heading
  let description = title;
  const paraMatch = markdown.replace(/\r/g, "").split(/\n\n+/).find(p => !p.startsWith("#"));
  if (paraMatch) description = paraMatch.split(/\n/).slice(0, 3).join(" ").trim();
  return { title, description };
}

async function loadMarkdownPrompts(server, { verbose = true } = {}) {
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
    const promptName = sanitizeName(baseRaw);
    const already = dynamicPromptState.loaded.get(promptName);
    if (already && already.mtime >= stat.mtimeMs) {
      continue; // unchanged
    }
    const content = fs.readFileSync(full, 'utf8');
    const { title, description } = extractMeta(content, baseRaw);

    try {
      // If already registered, we can't (depending on API) re-register; we skip or overwrite logically.
      if (!already) {
        server.prompt(
          promptName,
            description || title || promptName,
            {
              // Optional single variable to append user context to the markdown.
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

function listDynamicPrompts() {
  return Array.from(dynamicPromptState.loaded.entries()).map(([name, info]) => ({ name, file: info.file }));
}

const server = new McpServer({
  name: "MCP Server",
  version: "1.0.0",
})

server.tool("getApiKey", "Get the API key", {}, async ({}) => ({
  content: [{ type: "text", text: process.env.API_KEY || "API_KEY environment variable not set" }],
}))

// Tool: list dynamically loaded prompts
server.tool(
  "list_dynamic_prompts",
  "List the names and source files of dynamically loaded markdown prompts",
  {},
  async () => ({
    content: [{ type: 'text', text: JSON.stringify(listDynamicPrompts(), null, 2) }]
  })
);

// Tool: reload prompts on demand
server.tool(
  "reload_prompts",
  "Reload markdown prompt files from the prompts directory",
  {},
  async () => {
    const result = await loadMarkdownPrompts(server, { verbose: true });
    return { content: [{ type: 'text', text: `Reloaded. Newly registered: ${result.count}. Total: ${result.total}. Dir: ${result.dir}` }] };
  }
);

// ------------------------------
// Resources Tools
// ------------------------------
server.tool(
  'list_resources',
  'List dynamically loaded resource files',
  {},
  async () => ({ content: [{ type: 'text', text: JSON.stringify(listResources(), null, 2) }] })
);

server.tool(
  'reload_resources',
  'Reload resource files from resources / ressources directory',
  {},
  async () => {
    const result = await loadResources({ verbose: true });
    const exported = registerResourcesAsPrompts(server, { verbose: true }).exported;
    return { content: [{ type: 'text', text: `Resources reloaded. Newly registered: ${result.count}. Total: ${result.total}. Dir: ${result.dir}` }] };
  }
);

server.tool(
  'get_resource',
  'Get content of a resource by name',
  { name: z.string().describe('Resource name (filename slug)') },
  async ({ name }) => {
    try {
      const { meta, content } = getResourceContent(name);
      return { content: [{ type: 'text', text: `# ${name} (type: ${meta.type})\n\n${content}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
    }
  }
);

server.tool(
  'list_resource_prompts',
  'List prompt names generated automatically from resources',
  {},
  async () => {
    const names = Array.from(dynamicPromptState.loaded.keys()).filter(n => n.startsWith('resource_'));
    return { content: [{ type: 'text', text: JSON.stringify(names, null, 2) }] };
  }
);

// Initial load of markdown prompts before connecting
await loadMarkdownPrompts(server);
// Initial load of resources
const resourcesLoad = await loadResources();
registerResourcesAsPrompts(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.log(`MCP server started with ${dynamicPromptState.loaded.size} dynamic prompt(s) and ${resourcesLoad.total} resource(s)`);
