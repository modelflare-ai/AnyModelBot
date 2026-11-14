// 专属界面的桥接（父页面这一侧）：界面跑在沙箱 iframe 里，只能发消息给这里，这里只放行白名单方法。
// 审批相关的接口永远不开放给界面。界面这一侧在 ui/botkit/kit.js。
const METHODS = new Set(["init", "readFile", "readImage", "readMedia", "releaseMedia", "openFile", "openUrl", "setExpanded", "send", "stop", "subscribe", "pickFile", "openChannels", "reportError", "rendered"]);

/** 外部链接地址的长度上限：再长的多半是想把数据放进地址带出去 */
const URL_MAX = 2048;

/** 界面要打开的外部链接：只放行 http(s)，不带账号密码，不超长。不合格时返回 null */
export function safeExternalUrl(raw) {
  try {
    const u = new URL(String(raw));
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return null;
    return u.href.length > URL_MAX ? null : u.href;
  } catch {
    return null;
  }
}

/**
 * 把 handlers 接到 iframe 上。返回 { post(event, data), close() }。
 * 校验 event.source：只认这个 iframe 发来的消息；沙箱页是不透明来源，回消息只能用 "*"，而目标窗口已经确定。
 */
export function attachBridge(iframe, handlers) {
  const onMessage = async (e) => {
    if (!iframe.contentWindow || e.source !== iframe.contentWindow) return;
    const m = e.data;
    if (!m || m.amb !== 1 || m.id === undefined || !METHODS.has(m.method)) return;
    const reply = (body) => e.source.postMessage({ amb: 1, id: m.id, ...body }, "*");
    try {
      const fn = handlers[m.method];
      if (!fn) throw new Error(`unsupported: ${m.method}`);
      reply({ result: (await fn(m.params || {})) ?? null });
    } catch (err) {
      reply({ error: String(err?.message || err) });
    }
  };
  window.addEventListener("message", onMessage);
  return {
    post: (event, data) => iframe.contentWindow?.postMessage({ amb: 1, event, data }, "*"),
    close: () => window.removeEventListener("message", onMessage),
  };
}

/** 当前 App 的外观：界面据此设置 <html> 的属性，设计系统的 token 自动跟随 */
export function currentEnv() {
  const r = document.documentElement;
  return { lang: r.getAttribute("lang") || "en", theme: r.getAttribute("data-theme") || "light", text: r.getAttribute("data-text") || "md", motion: r.getAttribute("data-motion") || "full" };
}

/** App 切主题、语言、字号时通知（改的是 <html> 上的属性） */
export function watchEnv(fn) {
  const ob = new MutationObserver(() => fn(currentEnv()));
  ob.observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "data-theme", "data-text", "data-motion"] });
  return () => ob.disconnect();
}

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/**
 * 让用户选文件（点击的用户激活会传到父页面），读成 base64
 * @param {{ accept?: string, multiple?: boolean }} [opts]
 */
export function pickFiles({ accept, multiple } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = String(accept);
    input.multiple = !!multiple;
    input.addEventListener("change", async () => resolve(await Promise.all([...input.files].map(async (f) => ({ name: f.name, size: f.size, base64: await toBase64(f) })))));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
