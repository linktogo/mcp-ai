import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { loadAllMarkdownPrompts, listDynamicPrompts, dynamicPromptState } from './lib/prompts.js'
import { loadResources, listResources, getResourceContent, registerResourcesAsPrompts, dynamicResourceState } from './lib/resources.js'

// Prompt and resource logic moved into lib/prompts.js and lib/resources.js

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
    const result = await loadAllMarkdownPrompts(server, { verbose: true });
    return { content: [{ type: 'text', text: `Reloaded. Local newly registered: ${result.local.count}. Remote newly registered: ${result.remoteCount}` }] };
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

// Initial load of markdown prompts (local + remote) before connecting
await loadAllMarkdownPrompts(server);
// Initial load of resources
const resourcesLoad = await loadResources();
registerResourcesAsPrompts(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.log(`MCP server started with ${dynamicPromptState.loaded.size} dynamic prompt(s) and ${resourcesLoad.total} resource(s)`);
