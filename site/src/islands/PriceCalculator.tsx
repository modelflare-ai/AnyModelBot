// 每月费用计算器（§6.5 D）。状态同步到 URL（?m=&g=&d=&i=&o=），可分享；结果区 aria-live。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { PriceRow } from "../lib/pricing";
import { estimate, calcGroups, fmtMoney, fmtSmall, clampInt, LIMITS, PRESETS, type PresetId } from "../lib/calc";
import type { Dict } from "../i18n/zh";
import ModelCombobox from "./ModelCombobox";

type T = Dict["pricing"]["calc"];
interface Props { rows: PriceRow[]; defaultModel: string; t: T; fetchedAt: string; fullHref: string }

const f = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
const track = (n: string, p?: object) => { try { (window as any).umami?.track(n, p); } catch { /* 忽略 */ } };
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// 对数滑块：0…1000 ↔ [min, max]
const toLog = (v: number, [a, b]: readonly [number, number]) => Math.round((Math.log(v / a) / Math.log(b / a)) * 1000);
const fromLog = (p: number, [a, b]: readonly [number, number]) => {
  const v = a * Math.pow(b / a, p / 1000);
  const step = v < 1000 ? 10 : v < 10000 ? 100 : 1000;
  return clampInt(Math.round(v / step) * step, [a, b], a);
};

/** 数字变化时 500ms 内滚动到新值（减少动态效果时直接替换） */
function useRolling(target: number) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced()) { setV(target); from.current = target; return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 500), e = 1 - Math.pow(1 - k, 3);
      const x = a + (target - a) * e;
      setV(x); from.current = x;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

export default function PriceCalculator({ rows, defaultModel, t, fetchedAt, fullHref }: Props) {
  const def = { model: defaultModel, ...PRESETS.everyday };
  const [model, setModel] = useState(def.model);
  const [group, setGroup] = useState("");
  const [msgs, setMsgs] = useState<number>(def.msgs);
  const [inTok, setIn] = useState<number>(def.inTok);
  const [outTok, setOut] = useState<number>(def.outTok);
  const [open, setOpen] = useState(false);
  const ready = useRef(false);

  const row = rows.find((r) => r.model === model) ?? rows.find((r) => r.model === defaultModel)!;
  const groups = calcGroups(row);
  const g = groups.find((x) => x.id === group) ?? groups[0];
  const res = useMemo(() => estimate(row, { group: g.id, msgs, inTok, outTok }), [row, g.id, msgs, inTok, outTok]);
  const preset = (Object.keys(PRESETS) as PresetId[]).find((k) => PRESETS[k].msgs === msgs && PRESETS[k].inTok === inTok && PRESETS[k].outTok === outTok) ?? "custom";
  const shown = useRolling(res.monthly);

  // 读 URL（首页角色的月估算链接带 ?m= 过来）
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const m = p.get("m");
    if (m && rows.some((r) => r.model === m)) setModel(m);
    if (p.get("g")) setGroup(p.get("g")!);
    setMsgs(clampInt(p.get("d") ?? def.msgs, LIMITS.msgs, def.msgs));
    setIn(clampInt(p.get("i") ?? def.inTok, LIMITS.inTok, def.inTok));
    setOut(clampInt(p.get("o") ?? def.outTok, LIMITS.outTok, def.outTok));
    ready.current = true;
  }, []);

  // 写 URL（只在用户改过之后）+ 停止输入 800ms 后记一次
  useEffect(() => {
    if (!ready.current) return;
    const p = new URLSearchParams(location.search);
    p.set("m", row.model); p.set("g", g.id); p.set("d", String(msgs)); p.set("i", String(inTok)); p.set("o", String(outTok));
    history.replaceState(null, "", `${location.pathname}?${p}${location.hash}`);
    const id = setTimeout(() => track("pricing_calc_use", { model_id: row.model, preset, group: g.id }), 800);
    return () => clearTimeout(id);
  }, [row.model, g.id, msgs, inTok, outTok]);

  const amount = fmtMoney(shown);
  const copy = async () => {
    const text = f(t.copyText, { model: row.model, route: g.id, msgs, inTok: inTok.toLocaleString("en-US"), outTok: outTok.toLocaleString("en-US"), amount: fmtMoney(res.monthly), fetchedAt });
    try { await navigator.clipboard.writeText(text); (window as any).ambToast?.(document.documentElement.lang.startsWith("zh") ? "已复制" : "Copied"); }
    catch { (window as any).ambToast?.(text); }
    track("pricing_calc_copy");
  };
  const num = (v: number, set: (n: number) => void, lim: readonly [number, number], label: string, id: string, log: boolean, note?: string) => (
    <div class="calc__field">
      <label for={id}>{label}{note && <small class="muted"> · {note}</small>}</label>
      <div class="calc__inputs">
        <input type="range" min={log ? 0 : lim[0]} max={log ? 1000 : lim[1]} step={1} value={log ? toLog(v, lim) : v} aria-label={label}
          onInput={(e) => { const x = Number((e.target as HTMLInputElement).value); set(log ? fromLog(x, lim) : x); }} />
        <input type="number" id={id} class="mono" min={lim[0]} max={lim[1]} value={v} inputMode="numeric"
          onChange={(e) => set(clampInt((e.target as HTMLInputElement).value, lim, v))} />
      </div>
    </div>
  );

  return (
    <div class="calc">
      <div class="calc__form">
        <div class="calc__presets" role="group" aria-label={t.title}>
          {(Object.keys(PRESETS) as PresetId[]).map((k) => (
            <button type="button" class="chip" aria-pressed={preset === k} onClick={() => { setMsgs(PRESETS[k].msgs); setIn(PRESETS[k].inTok); setOut(PRESETS[k].outTok); }}>{t.presets[k]}</button>
          ))}
        </div>
        <div class="calc__field">
          <label for="calc-model">{t.model}</label>
          <ModelCombobox id="calc-model" label={t.model} value={row.model} placeholder={t.search} empty={t.none}
            options={rows.map((r) => ({ value: r.model, group: r.vendor }))}
            onChange={(m) => { setModel(m); setGroup(""); }} />
        </div>
        <fieldset class="calc__field calc__route">
          <legend>{t.route}</legend>
          {groups.map((x, i) => (
            <label class="chip">
              <input type="radio" name="calc-group" value={x.id} checked={x.id === g.id} onChange={() => setGroup(x.id)} />
              {i === 0 ? t.routeDefault : t.routeAward} <span class="mono muted">{x.id}</span>
            </label>
          ))}
          {groups.length > 1 && <small class="muted">{t.routeAward}: {t.routeAwardNote}</small>}
        </fieldset>
        {num(msgs, setMsgs, LIMITS.msgs, t.msgs, "calc-msgs", false)}
        {num(inTok, setIn, LIMITS.inTok, t.inTok, "calc-in", true, t.inTokNote)}
        {num(outTok, setOut, LIMITS.outTok, t.outTok, "calc-out", true)}
        <p class="small muted">{t.days} · {t.hint}</p>
      </div>
      <div class={`calc__result${open ? " is-open" : ""}`}>
        <div class="calc__big">
          <span aria-hidden="true">{(() => { const [pre, post = ""] = t.result.split("{amount}"); return <>{pre && <span class="pcard__unit">{pre}</span>}<span class="mono">{amount}</span>{post && <span class="pcard__unit">{post}</span>}</>; })()}</span>
          <span class="sr-only" aria-live="polite" aria-atomic="true">{f(t.result, { amount: fmtMoney(res.monthly) })}</span>
        </div>
        <button type="button" class="calc__bar-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{t.expandBar}</button>
        <dl class="calc__lines small">
          <div><dd class="tnum">{f(t.split, { input: fmtMoney(res.input), output: fmtMoney(res.output) })}</dd></div>
          <div><dd class="tnum">{f(t.perMsg, { amount: fmtSmall(res.perMsg) })}</dd></div>
          <div><dd class="tnum muted">{f(t.official, { amount: fmtMoney(res.official) })}</dd></div>
        </dl>
        <p class="small muted calc__disclaimer">{t.disclaimer}</p>
        <div class="calc__actions">
          <button type="button" class="btn btn--secondary btn--sm" onClick={copy}>{t.copy}</button>
          <a class="small" href={fullHref} target="_blank" rel="noopener" onClick={() => track("pricing_cta_click", { location: "calc" })}>{t.full}</a>
        </div>
      </div>
    </div>
  );
}
