// anymodel bot: optional "ask before input actions" gate for Computer Use (MIT, part of anymodel bot).
//
// Computer Use actions run automatically by default (no approval). The host loads this plugin only
// when a bot sets computerUse.approval = "ask-input": then every Computer Use tool that is not a
// read-only observation (AMB_CU_READ_TOOLS, comma-separated raw tool names) becomes a normal DSH
// approval request, which amb-bridge routes to the chat. Works for both backends (Cua Driver and
// the Codex bridge); both are registered under the same MCP server name.
export const name = 'amb-computer-use-gate'

const PREFIX = 'mcp__computer-use__'

export function apply(ctx) {
  if (process.env.AMB_CU_APPROVAL !== 'ask-input') return
  const read = new Set(String(process.env.AMB_CU_READ_TOOLS ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  ctx.on('tools/pre-execute', async (exec, next) => {
    const name = String(exec?.name ?? '')
    if (!name.startsWith(PREFIX)) return next()
    const downstream = await next()
    if (downstream?.kind !== 'allow') return downstream
    const action = name.slice(PREFIX.length)
    if (read.has(action)) return downstream
    return {
      kind: 'ask',
      reason: `Computer Use input action "${action}" needs the user's approval (this bot asks before input actions)`,
      displayReason: { en: `Computer Use: ${action}`, zh: `电脑操作：${action}` },
    }
  }, { prepend: true })
}
