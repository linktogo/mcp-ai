#!/usr/bin/env node
// Wrapper to run the Model Context Protocol inspector while ensuring
// arguments are passed as separate items to spawn (avoids ENOENT when
// a caller incorrectly concatenates the command and its args).

import { spawn } from 'child_process'
import path from 'path'

const inspectorPkg = '@modelcontextprotocol/inspector'
const cli = 'node'
const target = 'mcp_server.js'

const args = [inspectorPkg, cli, target]

const child = spawn('npx', args, { stdio: 'inherit', cwd: process.cwd(), shell: false })

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})

child.on('error', (err) => {
  console.error('Failed to launch inspector:', err)
  process.exit(1)
})
