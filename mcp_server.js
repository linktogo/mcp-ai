import { createMcpApp, connectStdio } from './lib/mcp_app.js'

// Create configured MCP application (tools registered) but do not connect transport here
const { server, dynamicPromptState, loadAllMarkdownPrompts, loadResources, registerResourcesAsPrompts } = createMcpApp()

// Initial load of markdown prompts (local + remote) before connecting
await loadAllMarkdownPrompts(server)
// Initial load of resources
const resourcesLoad = await loadResources()
registerResourcesAsPrompts(server)

// Connect stdio transport and start
await connectStdio(server)
console.log(`MCP server started with ${dynamicPromptState.loaded.size} dynamic prompt(s) and ${resourcesLoad.total} resource(s)`)
