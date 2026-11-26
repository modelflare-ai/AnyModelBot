// anymodel bot: Computer Use gates (MIT, part of anymodel bot).
//
// 1. macOS permission check (AMB_CU_PERMISSION_CHECK=1, desktop app on macOS): before any Computer Use
//    tool runs, ask the host (bridge /dsh/cu-permission) whether the app has the system permissions the
//    tool needs (Accessibility for input, Screen Recording for seeing the screen). When one is missing the
//    call is denied with an instruction not to retry, the host ends the turn and the chat shows how to
//    grant it. Read-only tools that touch neither the screen nor input pass through.
// 2. Optional "ask before input actions" (AMB_CU_APPROVAL=ask-input): every Computer Use tool that is not
//    a read-only observation (AMB_CU_READ_TOOLS, comma-separated raw tool names) becomes a normal DSH
//    approval request, which amb-bridge routes to the chat.
// Works for both backends (Cua Driver and the Codex bridge); both are registered under the same MCP server name.
export const name = 'amb-computer-use-gate'

const PREFIX = 'mcp__computer-use__'

async function permission(tool, sessionId) {
  const url = process.env.AMB_BRIDGE_URL
  const token = process.env.AMB_BRIDGE_TOKEN
  if (!url || !token) return { ok: true }
  try {
    const res = await fetch(`${url}/dsh/cu-permission`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ botId: process.env.AMB_BOT_ID ?? '', tool, sessionId }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { ok: true }
    return await res.json()
  } catch {
    // The host is unreachable: let the driver report its own error instead of blocking every call.
    return { ok: true }
  }
}

const LABEL = { accessibility: 'Accessibility', screen: 'Screen Recording' }

export function apply(ctx) {
  const check = process.env.AMB_CU_PERMISSION_CHECK === '1'
  const ask = process.env.AMB_CU_APPROVAL === 'ask-input'
  if (!check && !ask) return
  const read = new Set(String(process.env.AMB_CU_READ_TOOLS ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  ctx.on('tools/pre-execute', async (exec, next) => {
    const name = String(exec?.name ?? '')
    if (!name.startsWith(PREFIX)) return next()
    const action = name.slice(PREFIX.length)
    if (check) {
      const p = await permission(action, String(exec?.agent?.session?.id ?? exec?.agent?.id ?? ''))
      if (p && p.ok === false) {
        const missing = (Array.isArray(p.missing) ? p.missing : []).map((k) => LABEL[k] || k).join(' and ')
        return {
          kind: 'deny',
          reason: `macOS has not granted AnyModelBot the ${missing} permission needed for Computer Use. Do not call Computer Use tools again in this turn and do not retry. AnyModelBot is now showing the user a permission card in this chat and continues the task once it is turned on. Do not say that a system prompt has appeared and do not send the user to any settings page.`,
        }
      }
    }
    const downstream = await next()
    if (!ask || downstream?.kind !== 'allow') return downstream
    if (read.has(action)) return downstream
    return {
      kind: 'ask',
      reason: `Computer Use input action "${action}" needs the user's approval (this bot asks before input actions)`,
      displayReason: { en: `Computer Use: ${action}`, zh: `电脑操作：${action}`, 'zh-TW': `電腦操作：${action}` },
    }
  }, { prepend: true })
}
