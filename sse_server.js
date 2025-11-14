#!/usr/bin/env node
import http from 'http'
import url from 'url'
import { createMcpApp } from './lib/mcp_app.js'
import { authCheckHttp, authStatus } from './lib/auth.js'

const PORT = process.env.SSE_PORT || 4000

async function start() {
  const { server, dynamicPromptState, loadAllMarkdownPrompts, loadResources, registerResourcesAsPrompts, listDynamicPrompts, listResources } = createMcpApp()

  // load initial prompts/resources
  await loadAllMarkdownPrompts(server)
  const resourcesLoad = await loadResources()
  registerResourcesAsPrompts(server)

  const clients = new Set()

  const sendEvent = (data, event = 'message') => {
    const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`
    for (const res of clients) {
      try { res.write(payload) } catch (e) { /* ignore */ }
    }
  }

  const serverHttp = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true)
    if (req.method === 'GET' && parsed.pathname === '/events') {
      if (!authCheckHttp(req, res)) return
      // SSE handshake
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write('retry: 10000\n\n')
      clients.add(res)
      // send current state
      res.write(`event: hello\ndata: ${JSON.stringify({ prompts: Array.from(dynamicPromptState.loaded.keys()), resources: resourcesLoad.total })}\n\n`)
      req.on('close', () => clients.delete(res))
      return
    }

    if (req.method === 'POST' && parsed.pathname === '/reload_prompts') {
      if (!authCheckHttp(req, res)) return
      const result = await loadAllMarkdownPrompts(server)
      sendEvent({ type: 'reload_prompts', result })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
      return
    }

    if (req.method === 'POST' && parsed.pathname === '/reload_resources') {
      if (!authCheckHttp(req, res)) return
      const result = await loadResources()
      const exported = registerResourcesAsPrompts(server, { verbose: true }).exported
      sendEvent({ type: 'reload_resources', result, exported })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ result, exported }))
      return
    }

    if (req.method === 'GET' && parsed.pathname === '/list_dynamic_prompts') {
      if (!authCheckHttp(req, res)) return
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(listDynamicPrompts()))
      return
    }

    if (req.method === 'GET' && parsed.pathname === '/list_resources') {
      if (!authCheckHttp(req, res)) return
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(listResources()))
      return
    }

    // Generic tool invocation
    if (req.method === 'POST' && parsed.pathname && parsed.pathname.startsWith('/tool/')) {
      if (!authCheckHttp(req, res)) return
      const name = parsed.pathname.replace('/tool/', '')
      // read JSON body
      let body = ''
      for await (const chunk of req) body += chunk
      let payload = {}
      try { payload = body ? JSON.parse(body) : {} } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid json body' }))
        return
      }
      try {
        const result = await (server.invokeTool ? server.invokeTool(name, payload) : Promise.reject(new Error('invokeTool not available')))
        sendEvent({ type: 'tool_result', tool: name, result })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  serverHttp.listen(PORT, () => {
    console.log(`SSE server listening on http://localhost:${PORT}`)
  })
}

start().catch(err => {
  console.error('Failed to start SSE server:', err)
  process.exit(1)
})
