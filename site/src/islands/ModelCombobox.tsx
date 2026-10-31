// 可搜索的模型选择框（WAI-ARIA combobox + listbox），按厂商分组。
// 键盘：↓/↑ 移动、Enter 选中、Esc 收起并恢复原值、Home/End 跳到首尾；输入即筛选。
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

interface Option { value: string; group: string }
interface Props { id: string; label: string; options: Option[]; value: string; onChange: (v: string) => void; placeholder: string; empty: string }

export default function ModelCombobox({ id, label, options, value, onChange, placeholder, empty }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.value.toLowerCase().includes(s) || o.group.toLowerCase().includes(s)) : options;
  }, [q, options]);
  const groups = useMemo(() => [...new Set(filtered.map((o) => o.group))], [filtered]);
  const optId = (v: string) => `${id}-opt-${v.replace(/[^a-z0-9]+/gi, "-")}`;

  const openList = () => { setOpen(true); setQ(""); setActive(Math.max(0, options.findIndex((o) => o.value === value))); };
  const close = () => { setOpen(false); setQ(""); };
  const pick = (v: string) => { onChange(v); close(); input.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`#${CSS.escape(optId(filtered[active]?.value ?? ""))}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, filtered]);

  const onKey = (e: KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) { e.preventDefault(); openList(); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(filtered.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); const o = filtered[active]; if (o) pick(o.value); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close();
  };

  return (
    <div class="combo" onFocusOut={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) close(); }}>
      <div class="combo__field">
        <input
          ref={input} id={id} class="mono" type="text" role="combobox" autocomplete="off" spellcheck={false}
          aria-label={label} aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? optId(filtered[active].value) : undefined}
          placeholder={open ? placeholder : undefined}
          value={open ? q : value}
          onInput={(e) => { setQ((e.target as HTMLInputElement).value); setActive(0); if (!open) setOpen(true); }}
          onClick={() => (open ? null : openList())}
          onKeyDown={onKey}
        />
        <button type="button" class="combo__toggle" tabIndex={-1} aria-hidden="true" onMouseDown={(e) => e.preventDefault()} onClick={() => { if (open) close(); else { openList(); input.current?.focus(); } }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m7 10 5 5 5-5" /></svg>
        </button>
      </div>
      {open && (
        <ul class="combo__list" id={`${id}-list`} role="listbox" aria-label={label} ref={list}>
          {groups.map((g) => (
            <li role="presentation">
              <div class="combo__group" role="presentation">{g}</div>
              <ul role="group" aria-label={g}>
                {filtered.filter((o) => o.group === g).map((o) => {
                  const i = filtered.indexOf(o);
                  return (
                    <li id={optId(o.value)} role="option" aria-selected={o.value === value} class={`mono${i === active ? " is-active" : ""}`}
                      onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setActive(i)} onClick={() => pick(o.value)}>
                      {o.value}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {!filtered.length && <li class="combo__empty muted" role="presentation">{empty}</li>}
        </ul>
      )}
    </div>
  );
}
