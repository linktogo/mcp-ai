import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { loadAllMarkdownPrompts, listDynamicPrompts, dynamicPromptState } from './prompts.js'
import { loadResources, listResources, getResourceContent, registerResourcesAsPrompts, dynamicResourceState } from './resources.js'

export function createMcpApp() {
  const server = new McpServer({ name: 'MCP Server', version: '1.0.0' })
  const toolHandlers = new Map()

  function registerTool(name, description, schema, handler) {
    server.tool(name, description, schema, handler)
    toolHandlers.set(name, handler)
  }

  // Basic tool: getApiKey
  registerTool('getApiKey', 'Get the API key', {}, async ({}) => ({
    content: [{ type: 'text', text: process.env.API_KEY || 'API_KEY environment variable not set' }]
  }))

  // list dynamic prompts
  registerTool('list_dynamic_prompts', 'List the names and source files of dynamically loaded markdown prompts', {}, async () => ({
    content: [{ type: 'text', text: JSON.stringify(listDynamicPrompts(), null, 2) }]
  }))

  // reload prompts (local + remote)
  registerTool('reload_prompts', 'Reload markdown prompt files from the prompts directory', {}, async () => {
    const result = await loadAllMarkdownPrompts(server, { verbose: true })
    return { content: [{ type: 'text', text: `Reloaded. Local newly registered: ${result.local.count}. Remote newly registered: ${result.remoteCount}` }] }
  })

  // resources tools
  registerTool('list_resources', 'List dynamically loaded resource files', {}, async () => ({ content: [{ type: 'text', text: JSON.stringify(listResources(), null, 2) }] }))

  registerTool('reload_resources', 'Reload resource files from resources / ressources directory', {}, async () => {
    const result = await loadResources({ verbose: true })
    const exported = registerResourcesAsPrompts(server, { verbose: true }).exported
    return { content: [{ type: 'text', text: `Resources reloaded. Newly registered: ${result.count}. Total: ${result.total}. Dir: ${result.dir}` }] }
  })

  registerTool('get_resource', 'Get content of a resource by name', { name: z.string().describe('Resource name (filename slug)') }, async ({ name }) => {
    try {
      const { meta, content } = getResourceContent(name)
      return { content: [{ type: 'text', text: `# ${name} (type: ${meta.type})\n\n${content}` }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }] }
    }
  })

  registerTool('list_resource_prompts', 'List prompt names generated automatically from resources', {}, async () => {
    const names = Array.from(dynamicPromptState.loaded.keys()).filter(n => n.startsWith('resource_'))
    return { content: [{ type: 'text', text: JSON.stringify(names, null, 2) }] }
  })

  async function invokeTool(name, params = {}) {
    const handler = toolHandlers.get(name)
    if (!handler) throw new Error(`Tool not found: ${name}`)
    // call handler with params as provided by server.tool conventions
    return await handler(params)
  }

  return {
    server,
    dynamicPromptState,
    dynamicResourceState,
    loadAllMarkdownPrompts,
    loadResources,
    registerResourcesAsPrompts,
    listDynamicPrompts,
    listResources,
    getResourceContent,
    invokeTool,
  }
}

export async function connectStdio(server) {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
