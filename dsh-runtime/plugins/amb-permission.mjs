// anymodel bot: keep every session on the bot's configured permission preset (MIT, part of anymodel bot).
//
// DSH pins a preset into each session when it is created and keeps it on resume, so changing the
// bot's preset in the web UI (DSH_PERMISSION_MODE) would only affect new conversations. Before any
// tool runs we re-apply the configured preset to the calling session, so a switch to read-only
// takes effect in existing chats too.
//
// Rule sessions (3d) and their subagents get their own preset from the host (observe: read-only; act: at most
// workspace-write, even on a full-permission bot); amb-tasks puts it in a shared per-session map.
export const name = 'amb-permission'
export const inject = ['permissionPresets']

/** Shared with amb-tasks: sessionId → preset for rule sessions. */
const PRESETS = Symbol.for('amb.session.presets')

export function apply(ctx) {
  const fallback = process.env.DSH_PERMISSION_MODE || 'workspace-write'
  const presets = (globalThis[PRESETS] ??= new Map())
  ctx.on('tools/pre-execute', (exec, next) => {
    const session = exec?.agent?.session
    if (session) {
      // a rule session whose config never arrived is not in the map: it is refused by amb-tasks anyway
      const want = presets.get(String(session.id ?? exec?.agent?.id ?? '')) ?? (/^rule-/.test(String(session.id ?? '')) ? 'read-only' : fallback)
      try {
        if (ctx.permissionPresets.current(session) !== want) ctx.permissionPresets.set(session, want)
      } catch (e) {
        ctx.logger?.warn?.(`amb-permission: could not apply ${want}: ${e?.message ?? e}`)
        return { kind: 'deny', reason: `permission preset ${want} could not be applied` }
      }
    }
    return next()
  }, { prepend: true })
}
