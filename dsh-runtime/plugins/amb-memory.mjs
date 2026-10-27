// anymodel bot long-term memory tools + context-steward hook (MIT, part of anymodel bot).
//
// Registers remember / forget / recall. The memory files live in the host data directory,
// which the agent's file and shell tools cannot read; every operation goes through the host
// over the loopback bridge (AMB_BRIDGE_URL / AMB_BRIDGE_TOKEN), which resolves the session to
// its conversation, picks the scope (bot / group / team) and enforces caps and the secret filter.
//
// Steward hook: when the root agent goes idle, ask the host whether this session should be
// condensed in place; if so run DSH's own compaction (compactNow) and report back.
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'amb-memory'
export const inject = ['tools']

function bridge() {
  const url = process.env.AMB_BRIDGE_URL
  const token = process.env.AMB_BRIDGE_TOKEN
  if (!url || !token) return undefined
  return async (path, body, signal) => {
    const res = await fetch(url + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw new Error(`bridge ${path} ${res.status}`)
    return res.json()
  }
}

const SCOPE = {
  type: 'string',
  enum: ['own', 'group', 'team'],
  description: 'Where: "own" (this bot), "group" (this group chat; the default inside a group), or "team" (shared by all bots).',
}

const TEXT_OUT = {
  schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

export function apply(ctx) {
  const call = bridge()
  if (!call) return
  const botId = process.env.AMB_BOT_ID ?? ''

  const memoryOn = process.env.AMB_MEMORY !== '0'
  const run = async (op, args, exec) => {
    const sessionId = String(exec.agent?.session?.id ?? '')
    const r = await call('/dsh/memory', { botId, sessionId, op, args }, exec.signal)
    if (r.error) throw new Error(String(r.error))
    return { text: String(r.text ?? '') }
  }

  if (memoryOn) registerTools(ctx, run)
  stewardHook(ctx, call, botId)
}

function registerTools(ctx, run) {
  ctx.tools.register(defineTool({
    name: 'remember',
    description: 'Save one durable fact to long-term memory (one short sentence, at most 300 characters): a preference, who someone is, an agreement, a correction, a long-running project. Never store passwords, keys, tokens or ID numbers. Use topic for detail that need not be in every conversation.',
    parameters: {
      text: { type: 'string', required: true, description: 'The fact, one sentence.' },
      topic: { type: 'string', description: 'Optional topic file name (letters, digits, -, _; e.g. "project-x"). Omit for the main MEMORY.md.' },
      scope: SCOPE,
    },
    output: TEXT_OUT,
    execute: (args, exec) => run('remember', args, exec),
  }))

  ctx.tools.register(defineTool({
    name: 'forget',
    description: 'Delete long-term memory entries that contain the given text (an exact entry or a distinctive fragment). Use when a fact is outdated or the user asks you to forget it.',
    parameters: {
      match: { type: 'string', required: true, description: 'Text of the entry, or a distinctive part of it.' },
      topic: { type: 'string', description: 'Limit to one topic.' },
      all: { type: 'boolean', description: 'Delete every matching entry instead of failing when several match.' },
      scope: SCOPE,
    },
    output: TEXT_OUT,
    execute: (args, exec) => run('forget', args, exec),
  }))

  ctx.tools.register(defineTool({
    name: 'recall',
    description: 'Read long-term memory. No arguments: list what is stored in every scope you can read. query: search all scopes for entries containing every word. topic: read one whole topic. Call this before saying you do not know or do not remember something.',
    parameters: {
      query: { type: 'string', description: 'Words to search for.' },
      topic: { type: 'string', description: 'A topic to read in full.' },
      scope: SCOPE,
    },
    output: TEXT_OUT,
    execute: (args, exec) => run('recall', args, exec),
  }))

}

// ---------- context steward: condense in place when the host asks ----------
function stewardHook(ctx, call, botId) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['compaction'], (scope) => {
    const busy = new Set()
    const worked = new Set()
    scope.on('agent/status', ({ agent, status }) => {
      const sessionId = agent?.session?.id
      if (!sessionId) return
      if (status !== 'idle') return void worked.add(sessionId)
      // only on the transition from a turn to idle, and never re-entrantly
      if (!worked.delete(sessionId) || busy.has(sessionId)) return
      busy.add(sessionId)
      void (async () => {
        let result = 'none'
        try {
          const r = await call('/dsh/steward', { botId, sessionId, phase: 'idle' })
          if (r?.compact) {
            const done = await scope.compaction.compactNow(agent, AbortSignal.timeout(180_000))
            result = done === null ? 'nothing' : 'compacted'
          } else return
        } catch (e) {
          result = 'failed: ' + String(e?.message ?? e).slice(0, 200)
        } finally {
          busy.delete(sessionId)
        }
        await call('/dsh/steward', { botId, sessionId, phase: 'done', result }).catch(() => {})
      })()
    })
  })
}
