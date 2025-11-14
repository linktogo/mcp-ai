# LK-AI Project

An MCP (Model Context Protocol) server with dynamic prompt and resource management, supporting both STDIO and HTTP SSE transports. Load prompts from local directories or remote Git repositories with optional prefixing to manage naming collisions.

## About The Project

LK-AI is an intelligent agent platform built on the Model Context Protocol. It provides:
- **Dynamic Prompt Loading**: Local (`data/prompts/`) and remote Git-based sources.
- **Resource Management**: Load auxiliary resources (.md, .txt, .json) and optionally export as prompts.
- **Dual Transports**: STDIO (MCP CLI compatible) and HTTP SSE (Server-Sent Events) for real-time event streaming.
- **Modular Architecture**: Cleanly separated concerns (prompts, resources, utils) with a factory-based app creation.

Capabilities are defined by prompts and tools registered in the MCP server; interact via CLI inspector, HTTP REST endpoints, or custom SSE clients.

## Technology Stack

*   **Runtime**: Node.js (v18+)
*   **Core Protocol**: @modelcontextprotocol/sdk – MCP protocol implementation.
*   **Data Validation**: Zod – Type-safe schema validation.
*   **HTTP Server**: Node.js built-in http module with Server-Sent Events (SSE).
*   **Concurrency**: concurrently – Run multiple processes in parallel.

## Getting Started

Follow these instructions to get a local copy up and running.

### Prerequisites

You need to have Node.js (version 18.x or higher recommended) and npm installed on your machine.

### Installation

1.  Clone the repository:
    ```sh
    git clone https://github.com/linktogo/mcp-ai
    cd lk_ai
    ```

2.  Install NPM packages:
    ```sh
    npm install
    ```

### Running the Application

The project provides multiple ways to run the server:

#### 1. STDIO MCP Server (CLI-compatible)
```sh
npm start
```
Runs the MCP server via STDIO transport. Use with MCP CLI clients or the inspector.

#### 2. HTTP SSE Server
```sh
npm run sse
# or with explicit port
npm run sse:dev    # Listens on http://localhost:4000
```
Exposes HTTP endpoints and Server-Sent Events for real-time streaming.

#### 3. SSE + Inspector (Parallel)
```sh
npm run dev
```
Launches both the SSE server (port 4000) and the interactive MCP inspector simultaneously.

## Usage

### Exploring Tools & Prompts

#### Via Inspector
```sh
npm run inspector
```
Interactive CLI tool to list all registered tools, prompts, and resources. Test tools directly.

#### Via SSE HTTP Endpoints
When `npm run sse` or `npm run dev` is running:

**List prompts:**
```bash
curl http://localhost:4000/list_dynamic_prompts
```

**List resources:**
```bash
curl http://localhost:4000/list_resources
```

**Invoke a tool:**
```bash
curl -X POST http://localhost:4000/tool/reload_prompts -H 'Content-Type: application/json' -d '{}'
```

**Subscribe to events (SSE):**
```bash
curl http://localhost:4000/events
# Receives: hello, reload_prompts, reload_resources, tool_result events
```

### Managing Prompts

#### Local Prompts
Drop `.md` files into `data/prompts/` and they'll be auto-discovered on startup or via `reload_prompts` tool.

**Apply a prefix to local prompts:**
Edit `config/prompts_config.json`:
```json
{
  "prefixLocal": "myprefix"
}
```
Or set via environment:
```bash
PROMPTS_LOCAL_PREFIX=myteam npm start
```

#### Remote Prompts (Git-based)
Configure Git repositories in `config/prompts_sources.json`:
```json
[
  {
    "name": "team-prompts",
    "repo": "https://github.com/your-org/prompts-repo.git",
    "branch": "main",
    "subdir": "prompts",
    "prefix": "team"
  }
]
```

Remote repos are cloned into `data/remote_prompts/<name>/` (shallow clone, fast pulls). Use `prefix` to namespace prompts and avoid collisions (e.g., `team_my_prompt.md` if basename is `my_prompt.md`).

**Reload remotes:**
```bash
# Via inspector or SSE
reload_prompts
```

### Managing Resources

Drop `.md`, `.txt`, or `.json` files into `data/resources/` (or `data/ressources/`). They're auto-discovered and optionally exported as MCP prompts.

Toggle export via environment:
```bash
EXPORT_RESOURCES_AS_PROMPTS=false npm start
```

## Project Structure

```
.
├── mcp_server.js           # STDIO MCP entry point
├── sse_server.js           # HTTP SSE entry point
├── lib/
│   ├── mcp_app.js          # MCP factory: creates server + tools
│   ├── prompts.js          # Dynamic prompt loader (local + remote)
│   ├── resources.js        # Dynamic resource loader
│   ├── utils.js            # Shared utilities (sanitizeName, etc.)
│   └── run_inspector.js    # MCP inspector wrapper
├── config/
│   ├── prompts_config.json       # Local prompt prefix config
│   └── prompts_sources.json      # Remote Git sources config
├── data/
│   ├── prompts/            # Local prompts (*.md)
│   ├── resources/          # Auxiliary resources (*.md, *.txt, *.json)
│   └── remote_prompts/     # Cached remote Git repos
└── package.json            # Dependencies & scripts
```

## Architecture

**MCP App Factory** (`lib/mcp_app.js`):
- Creates a shared MCP server instance with all tools registered.
- Returns `{ server, invokeTool, ... }` for programmatic use.
- Used by both `mcp_server.js` (STDIO) and `sse_server.js` (HTTP).

**Prompt Loader** (`lib/prompts.js`):
- Scans `data/prompts/` and applies `prefixLocal`.
- Clones/pulls remote Git repos from `config/prompts_sources.json`.
- Supports per-source `prefix` to namespace imports.

**Resource Loader** (`lib/resources.js`):
- Scans `data/resources/` for auxiliary files.
- Auto-exports as MCP prompts (toggle via env).

**Tools Exposed:**
- `list_dynamic_prompts` – List all loaded prompts.
- `reload_prompts` – Reload local + remote prompts.
- `list_resources` – List all resources.
- `reload_resources` – Reload resources and re-export as prompts.
- `get_resource` – Fetch a specific resource content.
- `getApiKey` – Get API_KEY from environment.

## Environment Variables

- `PROMPTS_DIR` – Override local prompts directory (default: `data/prompts`).
- `PROMPTS_LOCAL_PREFIX` – Prefix to apply to local prompts (overrides config).
- `RESOURCES_DIR` – Override resources directory (default: `data/resources`).
- `EXPORT_RESOURCES_AS_PROMPTS` – Auto-export resources as prompts (default: `"true"`).
- `SSE_PORT` – SSE server listen port (default: `4000`).
- `API_KEY` – Exposed via `getApiKey` tool.
 - `AUTH_TYPE` – `static` or `jwt`. If omitted and `AUTH_TOKEN` is set, `static` is used.
 - `AUTH_TOKEN` – Static token value (used when `AUTH_TYPE=static`).
 - `JWT_SECRET` – Secret used to verify HS256 JWTs when `AUTH_TYPE=jwt`.
 - `AUTH_LEEWAY` – Optional clock leeway in seconds for JWT verification (default 0).
 - `PROMPTS_DIR` – Override local prompts directory (default: `data/prompts`).
 - `PROMPTS_LOCAL_PREFIX` – Prefix to apply to local prompts (overrides config).
 - `RESOURCES_DIR` – Override resources directory (default: `data/resources`).
 - `EXPORT_RESOURCES_AS_PROMPTS` – Auto-export resources as prompts (default: `"true"`).
 - `SSE_PORT` – SSE server listen port (default: `4000`).
 - `API_KEY` – Exposed via `getApiKey` tool.

## Troubleshooting

### Remote Git repos fail to clone
- Verify URL and branch exist.
- For private repos, configure SSH keys (`~/.ssh/config`) or HTTPS token auth.

### Prompts not showing up
- Check `data/prompts/` contains `.md` files.
- Verify `config/prompts_sources.json` is valid JSON.
- Run `reload_prompts` tool to trigger discovery.

### Prefix collisions
- Use unique `prefix` values in each `config/prompts_sources.json` entry.
- Check via `list_dynamic_prompts` to see actual names.

## Contributing

1. Add local prompts to `data/prompts/*.md`.
2. Configure remote sources in `config/prompts_sources.json`.
3. Adjust prefix settings in `config/prompts_config.json`.
4. Reload via the inspector or SSE endpoints.

## License

See LICENSE file.