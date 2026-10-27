// anymodel bot: keep every session on the bot's configured permission preset (MIT, part of anymodel bot).
//
// DSH pins a preset into each session when it is created and keeps it on resume, so changing the
// bot's preset in the web UI (DSH_PERMISSION_MODE) would only affect new conversations. Before any
// tool runs we re-apply the configured preset to the calling session, so a switch to read-only
// takes effect in existing chats too.
export const name = 'amb-permission'
export const inject = ['permissionPresets']

export function apply(ctx) {
  const want = process.env.DSH_PERMISSION_MODE || 'workspace-write'
  ctx.on('tools/pre-execute', (exec, next) => {
    const session = exec?.agent?.session
    if (session) {
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
