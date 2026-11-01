// 对话里交付的文件（代理的 present、后台任务的结果）：图片直接显示成缩略图，其它是一张文件卡片。
// 桌面版点开用系统的默认程序打开（打开就会运行的文件，服务端改成在文件夹中显示），卡片上另有「在文件夹中显示」；
// 网页里点开在新标签页打开（浏览器不该直接显示的类型，服务端让它下载）。文件由 /conversations/:id/file 提供，见 src/web/files.ts。
import { useState } from "preact/hooks";
import { html, Icon, IconButton } from "./ui.js";
import { api } from "../lib/api.js";
import { failed } from "../lib/store.js";
import { fmtSize } from "../lib/format.js";
import { t } from "../lib/i18n.js";

const enc = encodeURIComponent;
export const fileUrl = (conv, path) => `/amb/api/conversations/${enc(conv)}/file?path=${enc(path)}`;

/** 桌面版：open 用系统程序打开，reveal 在文件夹中显示 */
function desktop(conv, path, action) {
  return api(`/conversations/${enc(conv)}/file/${action}`, { method: "POST", body: { path } }).catch(failed);
}

/** 文件卡片：名字 + 大小；不在了的不能点 */
export function FileCard({ file, conv, canOpen }) {
  const sub = file.gone ? t("chat.file.gone") : file.size != null ? fmtSize(file.size) : "";
  const body = html`<${Icon} name="file" size="xl" class="fic" />
    <span class="grow"><span class="fname">${file.name}</span>${sub && html`<span class="fsub num">${sub}</span>`}</span>`;
  if (file.gone || !conv) return html`<div class="file-card off">${body}</div>`;
  if (!canOpen) return html`<a class="file-card" href=${fileUrl(conv, file.path)} target="_blank" rel="noopener" title=${t("chat.file.open", { name: file.name })}>${body}</a>`;
  return html`<div class="file-card">
    <button type="button" class="file-open" title=${t("chat.file.open", { name: file.name })} onClick=${() => desktop(conv, file.path, "open")}>${body}</button>
    <${IconButton} icon="folder" label=${t("chat.file.reveal")} onClick=${() => desktop(conv, file.path, "reveal")} />
  </div>`;
}

/** 图片：缩略图（保持比例，限宽限高），点开看大图；读不出来时退回文件卡片 */
export function ImageFile({ file, conv, canOpen, onLoad }) {
  const [broken, setBroken] = useState(false);
  if (broken || file.gone || !conv) return html`<${FileCard} file=${file} conv=${conv} canOpen=${canOpen} />`;
  const img = html`<img src=${fileUrl(conv, file.path)} alt=${file.name} loading="lazy" onLoad=${onLoad} onError=${() => setBroken(true)} />`;
  const title = t("chat.file.open", { name: file.name });
  if (!canOpen) return html`<a class="msg-img" href=${fileUrl(conv, file.path)} target="_blank" rel="noopener" title=${title}>${img}</a>`;
  return html`<button type="button" class="msg-img" title=${title} onClick=${() => desktop(conv, file.path, "open")}>${img}</button>`;
}

/** 一条回复交付的文件，按交付的顺序；放得下就排在一行 */
export function DeliveredFiles({ files, conv, canOpen, onLoad }) {
  if (!files?.length) return null;
  return html`<div class="msg-files">
    ${files.map((f) => (f.image ? html`<${ImageFile} key=${f.path} file=${f} conv=${conv} canOpen=${canOpen} onLoad=${onLoad} />` : html`<${FileCard} key=${f.path} file=${f} conv=${conv} canOpen=${canOpen} />`))}
  </div>`;
}
