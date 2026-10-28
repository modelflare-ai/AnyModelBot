// 时间与数量的中文显示。
const pad = (n) => String(n).padStart(2, "0");
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 消息流里的时间分隔条："今天 15:33" / "昨天 09:10" / "10月26日 14:00" / "2025年3月1日 08:00" */
export function fmtSep(t) {
  const d = new Date(t);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `今天 ${hm(d)}`;
  if (diff === 1) return `昨天 ${hm(d)}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm(d)}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm(d)}`;
}

/** 列表里的相对时间："刚刚" / "5 分钟前" / "15:33" / "10月26日" */
export function fmtAgo(t) {
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  const d = new Date(t);
  if (new Date().toDateString() === d.toDateString()) return hm(d);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtTime(t) {
  return t ? new Date(t).toLocaleString("zh-CN", { hour12: false }) : "";
}
