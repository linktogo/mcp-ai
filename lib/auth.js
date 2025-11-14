// Simple auth utility for MCP servers
// - Supports static token auth via env AUTH_TOKEN
// - Can be disabled with CLI flag --no-auth or --disable-auth
// - Exposes helper for HTTP endpoints to validate Authorization header or ?auth query

import url from 'url'
import jwt from 'jsonwebtoken'

const CLI_DISABLE_FLAGS = ['--no-auth', '--disable-auth']

const AUTH_TYPE = process.env.AUTH_TYPE || null // 'static' or 'jwt'
const JWT_SECRET = process.env.JWT_SECRET || null
const AUTH_LEEWAY = parseInt(process.env.AUTH_LEEWAY || '0', 10)

export function isAuthDisabledByCli() {
  return process.argv.some(a => CLI_DISABLE_FLAGS.includes(a))
}

export function getAuthToken() {
  return process.env.AUTH_TOKEN || null
}

export function isAuthEnabled() {
  if (isAuthDisabledByCli()) return false
  // explicit mode
  const mode = AUTH_TYPE || (getAuthToken() ? 'static' : null)
  if (!mode) return false
  if (mode === 'static') {
    const token = getAuthToken()
    return !!token
  }
  if (mode === 'jwt') {
    return !!JWT_SECRET
  }
  return false
}

export const AUTH_HEADER = 'authorization'

function parseBearer(header) {
  if (!header) return null
  const m = header.match(/^Bearer\s+(.+)$/i)
  if (m) return m[1]
  return header // fallback: raw token
}

// Validate against configured token. Accepts:
// - Authorization: Bearer <token>
// - ?auth=<token>
// - X-Api-Key: <token>
export function validateRequestToken(req) {
  if (!isAuthEnabled()) return { ok: true }
  const mode = AUTH_TYPE || (getAuthToken() ? 'static' : null)
  // check headers / query for token
  const ah = req.headers[AUTH_HEADER]
  const headerCandidate = parseBearer(ah) || req.headers['x-api-key']
  try {
    const parsed = url.parse(req.url, true)
    const queryCandidate = parsed.query && parsed.query.auth
    if (mode === 'static') {
      const token = getAuthToken()
      const candidate = headerCandidate || queryCandidate
      if (candidate && candidate === token) return { ok: true }
      return { ok: false, message: 'Unauthorized' }
    }
    if (mode === 'jwt') {
      const token = headerCandidate || queryCandidate
      if (!token) return { ok: false, message: 'Missing token' }
      try {
        const opts = AUTH_LEEWAY ? { clockTolerance: AUTH_LEEWAY } : {}
        const payload = jwt.verify(token, JWT_SECRET, opts)
        return { ok: true, payload }
      } catch (e) {
        return { ok: false, message: `JWT validation failed: ${e.message}` }
      }
    }
  } catch (e) {
    return { ok: false, message: `Auth parse error: ${e.message}` }
  }
  return { ok: false, message: 'Unauthorized' }
}

// For HTTP handlers: validate and if unauthorized, write a 401 response and return false
export function authCheckHttp(req, res) {
  const v = validateRequestToken(req)
  if (v.ok) return true
  res.writeHead(401, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: v.message || 'unauthorized' }))
  return false
}

// Convenience: check if auth is required and return descriptive status
export function authStatus() {
  return { enabled: isAuthEnabled(), tokenConfigured: !!getAuthToken(), disabledByCli: isAuthDisabledByCli() }
}

export default { isAuthEnabled, isAuthDisabledByCli, getAuthToken, validateRequestToken, authCheckHttp, authStatus }
