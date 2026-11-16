/**
 * Host half of the "Crédits restants DSH" panel.
 *
 * One data source: the provider's own billing balance for the account DSH
 * uses — `GET https://api.deepseek.com/user/balance`, authenticated with the
 * same credential reference the shipped DeepSeek API-key provider resolves for
 * inference (`DEEPSEEK_API_KEY`). One local state file keeps the last known
 * value between sessions. Reads happen only when the panel asks for one; there
 * is no timer, no polling and no other endpoint.
 *
 * The browser half (./client) calls two exact Fetch routes through the Host's
 * existing `/api` channel, so authentication, Host/Origin checks and Peer
 * admission stay with the connection service instead of being re-implemented
 * here:
 *
 *   GET  /api/dsh-credits-9d8b1b1d/state    → last known value, no provider call
 *   POST /api/dsh-credits-9d8b1b1d/refresh  → provider read, persisted
 *
 * @module @dsh-local/view-9d8b1b1d-9385-48b3-84eb-73e6b545a530
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Route base, mirrored (without the leading slash) by the browser half. */
const API_BASE = '/api/dsh-credits-9d8b1b1d'
const STATE_ROUTE = `${API_BASE}/state`
const REFRESH_ROUTE = `${API_BASE}/refresh`

/**
 * The documented billing-balance endpoint of the provider's API:
 * `{ is_available, balance_infos: [{ currency, total_balance,
 * granted_balance, topped_up_balance }] }`.
 */
const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/**
 * Credential reference the DeepSeek API-key provider reads for inference
 * (`llm-deepseek-api-key`, `apiKeyEnv` default `DEEPSEEK_API_KEY`), so it
 * names the exact account whose remaining credits this panel shows.
 */
const CREDENTIAL_REF = 'DEEPSEEK_API_KEY'

/** Ceiling for the provider request; a slow billing endpoint fails as one. */
const REQUEST_TIMEOUT_MS = 20_000

/** Store schema version (bumped when the persisted shape changes). */
const STORE_VERSION = 1
/** Directory under the DSH home that this plugin owns. */
const STORE_DIR = 'dsh-credits-9d8b1b1d'
const STORE_FILE = 'state.json'

/**
 * Stable failure codes shared with the browser half (it owns the wording).
 * @typedef {'no-key'|'unauthorized'|'timeout'|'network'|'provider'|'internal'} FailureCode
 */
const FAILURE_CODES = new Set(['no-key', 'unauthorized', 'timeout', 'network', 'provider', 'internal'])

/**
 * One wallet balance exactly as the provider reported it, in decimal string
 * form, so the browser half decides how to format the amount.
 * @typedef {{ currency: string, total: string, toppedUp: string, granted: string }} Wallet
 */

/**
 * The last known balance plus when it was read and how the last attempt went.
 * @typedef {{
 *   version: number,
 *   updatedAt: string | null,
 *   available: boolean | null,
 *   wallets: readonly Wallet[],
 *   lastFailure: { code: FailureCode, at: string } | null,
 * }} CreditsState
 */

/** A provider read failure carrying a stable code. */
class CreditsError extends Error {
  /**
   * @param {FailureCode} code - stable failure code.
   */
  constructor(code) {
    super(`dsh-credits: ${code}`)
    this.name = 'CreditsError'
    this.code = code
  }
}

/** @returns {string} this machine's DSH home directory. */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim()
  return join(homedir(), '.dsh')
}

/** @returns {string} absolute path of this plugin's state file. */
function statePath() {
  return join(dshHome(), STORE_DIR, STORE_FILE)
}

/** @returns {CreditsState} the state before anything was ever read. */
function emptyState() {
  return { version: STORE_VERSION, updatedAt: null, available: null, wallets: [], lastFailure: null }
}

/**
 * Narrow one decimal amount to its string form.
 * @param {unknown} value - provider or persisted value.
 * @returns {string | null} the decimal string, or null when it is not an amount.
 */
function decimalOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null
}

/**
 * Narrow a persisted failure record.
 * @param {unknown} value - persisted value.
 * @returns {{ code: FailureCode, at: string } | null} the record, or null.
 */
function failureOf(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const code = value.code
  const at = value.at
  if (typeof code !== 'string' || !FAILURE_CODES.has(code)) return null
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null
  return { code: /** @type {FailureCode} */ (code), at }
}

/**
 * Validate one persisted or in-memory state document. Anything unrecognizable
 * is dropped field by field rather than trusted.
 * @param {unknown} value - candidate document.
 * @returns {CreditsState | null} the state, or null when it is not a state at all.
 */
function stateOf(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const updatedAt = typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt))
    ? value.updatedAt
    : null
  const available = typeof value.available === 'boolean' ? value.available : null
  /** @type {Wallet[]} */
  const wallets = []
  if (Array.isArray(value.wallets)) {
    for (const entry of value.wallets) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const currency = typeof entry.currency === 'string' ? entry.currency.trim() : ''
      const total = decimalOf(entry.total)
      if (currency === '' || total === null) continue
      wallets.push({
        currency,
        total,
        toppedUp: decimalOf(entry.toppedUp) ?? '0.00',
        granted: decimalOf(entry.granted) ?? '0.00',
      })
    }
  }
  return { version: STORE_VERSION, updatedAt, available, wallets, lastFailure: failureOf(value.lastFailure) }
}

/**
 * Read the persisted state.
 * @returns {CreditsState | null} the stored state, or null when none is usable.
 */
function readPersisted() {
  let raw
  try {
    raw = readFileSync(statePath(), 'utf8')
  } catch {
    return null
  }
  try {
    return stateOf(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * Write the state atomically (0600, temp file in the same directory, fsync,
 * rename) so a crash never leaves a half-written balance behind.
 * @param {CreditsState} state - state to persist.
 */
function writePersisted(state) {
  const file = statePath()
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temporary = join(dir, `.${STORE_FILE}.${process.pid}.${Date.now()}.tmp`)
  const handle = openSync(temporary, 'w', 0o600)
  try {
    writeFileSync(handle, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
  renameSync(temporary, file)
}

/**
 * In-process cache of the state file: the file is the durable copy, this is
 * what a browser request reads between writes.
 * @type {CreditsState | null}
 */
let cache = null

/** @returns {CreditsState} the current state, loading it once from disk. */
function currentState() {
  if (cache === null) cache = readPersisted() ?? emptyState()
  return cache
}

/**
 * Publish one state in memory and try to persist it. A failed write keeps the
 * panel consistent for the running process and never fabricates durability.
 * @param {CreditsState} state - state to publish.
 */
function commit(state) {
  cache = state
  try {
    writePersisted(state)
  } catch (error) {
    console.warn('[dsh-credits] the last known value could not be saved:', error instanceof Error ? error.message : error)
  }
}

/**
 * Resolve the API key DSH itself infers with.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {Promise<string>} the credential value.
 */
async function resolveKey(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    let hit
    try {
      hit = await credentials.resolve(CREDENTIAL_REF)
    } catch {
      throw new CreditsError('internal')
    }
    if (hit !== undefined && typeof hit.value === 'string' && hit.value.trim() !== '') return hit.value.trim()
  }
  const ambient = process.env.DEEPSEEK_API_KEY
  if (typeof ambient === 'string' && ambient.trim() !== '') return ambient.trim()
  throw new CreditsError('no-key')
}

/**
 * Whether a fetch rejection was the request timeout.
 * @param {unknown} error - rejection reason.
 * @returns {boolean} true for a timeout or abort.
 */
function isTimeout(error) {
  if (error === null || typeof error !== 'object') return false
  return error.name === 'TimeoutError' || error.name === 'AbortError'
}

/**
 * Read the provider's billing balance for the DSH account.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {Promise<{ wallets: Wallet[], available: boolean | null }>} the read balance.
 */
async function fetchBalance(ctx) {
  const key = await resolveKey(ctx)
  let response
  try {
    response = await fetch(BALANCE_URL, {
      method: 'GET',
      // The key never leaves this origin: redirects are refused, not followed.
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new CreditsError(isTimeout(error) ? 'timeout' : 'network')
  }
  if (response.status === 401 || response.status === 403) throw new CreditsError('unauthorized')
  if (!response.ok) throw new CreditsError('provider')
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new CreditsError('provider')
  }
  if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.balance_infos)) {
    throw new CreditsError('provider')
  }
  /** @type {Wallet[]} */
  const wallets = []
  for (const info of payload.balance_infos) {
    if (info === null || typeof info !== 'object' || Array.isArray(info)) continue
    const currency = typeof info.currency === 'string' ? info.currency.trim() : ''
    const total = decimalOf(info.total_balance)
    if (currency === '' || total === null) continue
    wallets.push({
      currency,
      total,
      toppedUp: decimalOf(info.topped_up_balance) ?? '0.00',
      granted: decimalOf(info.granted_balance) ?? '0.00',
    })
  }
  // Reported wallets that all failed to parse mean the response shape moved,
  // not that the account holds nothing.
  if (payload.balance_infos.length > 0 && wallets.length === 0) throw new CreditsError('provider')
  return { wallets, available: typeof payload.is_available === 'boolean' ? payload.is_available : null }
}

/**
 * One provider refresh in flight at a time; concurrent requests share it.
 * @type {Promise<CreditsState> | null}
 */
let inFlight = null

/**
 * Read the provider and publish the outcome. A failed read keeps the previous
 * balance and timestamps only the failure, so the panel can show a stale value
 * with the reason it is stale.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {Promise<CreditsState>} the state after the attempt.
 */
function refresh(ctx) {
  if (inFlight !== null) return inFlight
  const attempt = (async () => {
    const previous = currentState()
    try {
      const { wallets, available } = await fetchBalance(ctx)
      const next = {
        version: STORE_VERSION,
        updatedAt: new Date().toISOString(),
        available,
        wallets,
        lastFailure: null,
      }
      commit(next)
      return next
    } catch (error) {
      const code = error instanceof CreditsError ? error.code : 'internal'
      const next = {
        ...previous,
        version: STORE_VERSION,
        lastFailure: { code, at: new Date().toISOString() },
      }
      commit(next)
      return next
    }
  })()
  inFlight = attempt.finally(() => {
    inFlight = null
  })
  return inFlight
}

/**
 * Serialize one route answer.
 * @param {unknown} body - JSON body.
 * @param {number} [status] - HTTP status.
 * @returns {Response} the response.
 */
function answer(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Services this Host half needs before it can answer at all. */
export const inject = ['connection']

/**
 * Register the two exact Fetch routes inside the Host's authenticated `/api`
 * channel. Route disposal is owned by the connection service's effect, so
 * unloading this plugin removes both answers and nothing else.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: STATE_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => Promise.resolve(answer(currentState())),
  }))
  ctx.effect(() => ctx.connection.fetch.register({
    path: REFRESH_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: () => refresh(ctx).then(
      (state) => answer(state),
      () => answer({ code: 'internal' }, 500),
    ),
  }))
}
