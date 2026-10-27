// anymodel bot: approval gate for the bundled Computer Use MCP tools (MIT, part of anymodel bot).
//
// The upstream bridge (songkeys/kimi-computer-use) auto-accepts the Computer Use service's own
// app-access prompts, so every desktop action is gated here instead: the call is turned into a
// normal DSH approval request, which amb-bridge routes to the chat (y/n code or card buttons).
// AMB_CU_APPROVAL=readonly-free lets read-only observation tools (list_apps, get_app_state) through.
export const name = 'amb-computer-use-gate'

const PREFIX = 'mcp__computer-use__'
const READONLY = new Set(['list_apps', 'get_app_state'])

export function apply(ctx) {
  const relaxed = process.env.AMB_CU_APPROVAL === 'readonly-free'
  ctx.on('tools/pre-execute', async (exec, next) => {
    const name = String(exec?.name ?? '')
    if (!name.startsWith(PREFIX)) return next()
    const downstream = await next()
    if (downstream?.kind !== 'allow') return downstream
    if (relaxed && READONLY.has(name.slice(PREFIX.length))) return downstream
    const action = name.slice(PREFIX.length)
    return {
      kind: 'ask',
      reason: `Computer Use action "${action}" controls this Mac and needs the user's approval`,
      displayReason: { en: `Computer Use: ${action}`, zh: `电脑操作：${action}` },
    }
  }, { prepend: true })
}
