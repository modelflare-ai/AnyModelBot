// 与 Modelflare web/default/src/lib/avatar.ts 一致：名称稳定选色，两步相邻色组成柔和渐变。
import { useEffect, useState } from "preact/hooks";
import { html, Skeleton } from "./ui.js";

export function userAvatarGradient(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return {
    "--user-avatar-from": `var(--user-avatar-tone-${(hash % 12) + 1})`,
    "--user-avatar-to": `var(--user-avatar-tone-${((hash + 2) % 12) + 1})`,
  };
}

/** 相邻的账户名称提供可访问文本，头像本身只负责呈现。 */
export function UserAvatar({ name = "", class: cls = "", src = "", fallback = false, loading = false }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (loading) return html`<span class=${`user-avatar ${cls}`} aria-hidden="true"><${Skeleton} w="100%" h=${32} /></span>`;
  return html`<span class=${`user-avatar ${cls}`} style=${userAvatarGradient(name)} aria-hidden="true">
    ${src && !broken ? html`<img src=${src} alt="" referrerpolicy="no-referrer" onError=${() => setBroken(true)} />`
      : fallback ? html`<img src="/amb/static/assets/modelflare.svg" alt="" />` : [...name.trim()][0]?.toUpperCase() || "?"}</span>`;
}
