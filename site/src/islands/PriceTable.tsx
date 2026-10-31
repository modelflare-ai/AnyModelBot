// 公开价格表（§6.5 C）：默认 6 个精选行；展开后可搜索、按厂商过滤；每行可展开看全部线路。
import { useMemo, useState } from "preact/hooks";
import type { PriceRow } from "../lib/pricing";
import { fmtPrice } from "../lib/pricing";
import type { Dict } from "../i18n/zh";

type T = Dict["pricing"]["table"];
interface Props { rows: PriceRow[]; featured: string[]; t: T; mediaText: string; mediaHref: string; initialAll?: boolean }

const f = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
export const ctx = (n: number | null) => (n == null ? "" : n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}K`);
const pct = (r: number) => `${+(r * 100).toFixed(2)}%`;
const track = (n: string, p?: object) => { try { (window as any).umami?.track(n, p); } catch { /* 忽略 */ } };

export default function PriceTable({ rows, featured, t, mediaText, mediaHref, initialAll = false }: Props) {
  const [all, setAll] = useState(initialAll);
  const [q, setQ] = useState("");
  const [vendor, setVendor] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const vendors = useMemo(() => [...new Set(rows.map((r) => r.vendor))], [rows]);
  const list = useMemo(() => {
    if (!all) return featured.map((m) => rows.find((r) => r.model === m)!).filter(Boolean);
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (!vendor || r.vendor === vendor) && (!s || r.model.toLowerCase().includes(s) || r.vendor.toLowerCase().includes(s)));
  }, [all, q, vendor, rows, featured]);
  // 全部模型时按厂商分组（顺序同价格数据），精选时不分组
  const sections = useMemo(() => (all
    ? [...new Set(list.map((r) => r.vendor))].map((v) => ({ vendor: v as string | null, rows: list.filter((r) => r.vendor === v) }))
    : [{ vendor: null as string | null, rows: list }]), [all, list]);
  const toggle = (m: string) => {
    const n = new Set(open);
    if (n.has(m)) n.delete(m); else { n.add(m); track("pricing_row_expand", { model_id: m }); }
    setOpen(n);
  };
  const textCount = rows.length;

  return (
    <div class="ptable">
      {all && (
        <div class="ptable__tools">
          <label class="ptable__search"><span class="sr-only">{t.search}</span>
            <input type="search" placeholder={t.search} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          </label>
          <div class="ptable__vendors" role="group" aria-label={t.allVendors}>
            <button type="button" class="chip" aria-pressed={vendor === ""} onClick={() => setVendor("")}>{t.allVendors}</button>
            {vendors.map((v) => <button type="button" class="chip" aria-pressed={vendor === v} onClick={() => setVendor(vendor === v ? "" : v)}>{v}</button>)}
          </div>
        </div>
      )}
      <div class="table-wrap">
        <table class="table ptable__table">
          <caption class="sr-only">{t.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.col.model}</th>
              <th scope="col">{t.col.route}</th>
              <th scope="col" class="num-col">{t.col.input}</th>
              <th scope="col" class="num-col">{t.col.output}</th>
              <th scope="col" class="num-col hide-md">{t.col.official}</th>
              <th scope="col" class="num-col hide-md">{t.col.vs}</th>
              <th scope="col"><span class="sr-only">{t.detail.route}</span></th>
            </tr>
          </thead>
          {sections.map((sec) => [
            sec.vendor && (
              <tbody class="ptable__group" key={`g-${sec.vendor}`}>
                <tr><th scope="rowgroup" colSpan={7}>{sec.vendor} <span class="muted">· {sec.rows.length}</span></th></tr>
              </tbody>
            ),
            ...sec.rows.map((r) => {
              const isOpen = open.has(r.model);
              const id = `pr-${r.model.replace(/[^a-z0-9]+/gi, "-")}`;
              const long = r.tiers.length > 1 ? r.tiers[r.tiers.length - 1] : null;
              return (
                <tbody class={isOpen ? "is-open" : ""} key={r.model}>
                  <tr>
                    <th scope="row" class="ptable__model">
                      <span class="mono">{r.model}</span>
                      <small>{r.vendor}{r.contextWindow ? ` · ${f(t.context, { n: ctx(r.contextWindow) })}` : ""}</small>
                    </th>
                    <td data-label={t.col.route}><span class="badge badge--neutral">{r.defaultGroup}</span> <span class="badge badge--accent">{t.default}</span></td>
                    <td class="num-col mono" data-label={t.col.input}>{fmtPrice(r.input)}</td>
                    <td class="num-col mono" data-label={t.col.output}>{fmtPrice(r.output)}</td>
                    <td class="num-col mono hide-md" data-label={t.col.official}>{`${fmtPrice(r.officialInput)} / ${fmtPrice(r.officialOutput)}`}</td>
                    <td class="num-col mono hide-md" data-label={t.col.vs}>{pct(r.ratio)}</td>
                    <td class="ptable__toggle">
                      <button type="button" class="icon-btn" aria-expanded={isOpen} aria-controls={id} aria-label={f(t.expand, { model: r.model })} onClick={() => toggle(r.model)}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                      </button>
                    </td>
                  </tr>
                  <tr class="ptable__detail" id={id} hidden={!isOpen}>
                    <td colSpan={7}>
                      {isOpen && (
                        <div class="pdetail">
                          <p class="pdetail__official small muted show-md">
                            {t.col.official}: <span class="mono">{`${fmtPrice(r.officialInput)} / ${fmtPrice(r.officialOutput)}`}</span> · {t.col.vs}: <span class="mono">{pct(r.ratio)}</span>
                          </p>
                          <table class="table pdetail__table">
                            <thead><tr><th scope="col">{t.detail.route}</th><th scope="col">{t.detail.positioning}</th><th scope="col" class="num-col">{t.detail.vs}</th><th scope="col" class="num-col">{t.detail.price}</th></tr></thead>
                            <tbody>
                              {r.groups.map((g) => (
                                <tr>
                                  <th scope="row"><span class="mono">{g.id}</span>{g.isDefault && <> <span class="badge badge--accent">{t.default}</span></>}{g.conditional && <svg class="ptable__lock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>}</th>
                                  <td>{t.positioning[g.kind]}{g.conditional && <><br /><small class="pdetail__unlock">{f(t.unlock, { amount: g.conditional.minTopupUSD })}</small></>}</td>
                                  <td class="num-col mono">{pct(g.ratio)}</td>
                                  <td class="num-col mono">{fmtPrice(g.input)} / {fmtPrice(g.output)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {long && long.maxInputTokens == null && r.tiers[0].maxInputTokens != null && (
                            <p class="small muted">{f(t.tiers, { n: r.tiers[0].maxInputTokens.toLocaleString("en-US"), input: fmtPrice(long.input * r.ratio), output: fmtPrice(long.output * r.ratio) })}</p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                </tbody>
              );
            }),
          ])}
        </table>
        {list.length === 0 && <p class="ptable__none muted">{t.none}</p>}
      </div>
      <div class="ptable__foot">
        <button type="button" class="btn btn--secondary" aria-expanded={all} onClick={() => { setAll(!all); if (!all) track("pricing_table_expand"); }}>
          {all ? t.showFeatured : f(t.showAll, { textCount })}
        </button>
        <a class="small" href={mediaHref} target="_blank" rel="noopener">{mediaText}</a>
      </div>
    </div>
  );
}
