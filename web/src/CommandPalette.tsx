import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type PaletteItem = {
  id: string;
  label: string;
  section: string;
  hint?: string;
  dotColor?: string;
  disabled?: boolean;
  // Return true to keep the palette open (e.g. after arming the first oracle).
  run: () => boolean | void;
};

// Subsequence fuzzy match: null = no match; lower score = tighter/earlier hit.
function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t.startsWith(q)) return -100; // strong prefix bonus
  let qi = 0;
  let score = 0;
  let last = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += ti - last; // reward consecutive / early matches
      last = ti;
      qi++;
    }
  }
  return qi === q.length ? score : null;
}

type Props = {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
  placeholder?: string;
};

export default function CommandPalette({
  open,
  onClose,
  items,
  placeholder = "Search oracles or actions…",
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset + focus on open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const scored = items
      .map((it) => ({ it, score: fuzzyScore(query, it.label) }))
      .filter((x): x is { it: PaletteItem; score: number } => x.score !== null)
      .sort((a, b) => a.score - b.score);
    return scored.map((x) => x.it);
  }, [items, query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Keep the active row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runItem = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item || item.disabled) return;
      const keepOpen = item.run();
      if (!keepOpen) onClose();
    },
    [onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (filtered.length ? (a + 1) % filtered.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) =>
          filtered.length ? (a - 1 + filtered.length) % filtered.length : 0,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        runItem(filtered[active]);
      }
    },
    [filtered, active, onClose, runItem],
  );

  if (!open) return null;

  // Section order preserved from first appearance in the filtered list.
  const sections: string[] = [];
  for (const it of filtered) if (!sections.includes(it.section)) sections.push(it.section);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]"
      style={{ background: "rgba(6,6,10,0.62)", backdropFilter: "blur(4px)" }}
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl"
        style={{ background: "#111119", borderColor: "#2a2a37" }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div
          className="flex items-center gap-2.5 border-b px-4"
          style={{ borderColor: "#20202b" }}
        >
          <span className="text-neutral-500" aria-hidden>
            ⌘K
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="w-full bg-transparent py-3.5 text-[15px] text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div
          ref={listRef}
          className="max-h-[52vh] overflow-y-auto py-1.5"
          role="listbox"
        >
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-neutral-600">
              No matches for “{query}”
            </div>
          )}
          {sections.map((section) => (
            <div key={section}>
              <div className="px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-neutral-600">
                {section}
              </div>
              {filtered
                .map((it, i) => ({ it, i }))
                .filter(({ it }) => it.section === section)
                .map(({ it, i }) => {
                  const isActive = i === active;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      data-idx={i}
                      role="option"
                      aria-selected={isActive}
                      disabled={it.disabled}
                      onMouseMove={() => setActive(i)}
                      onClick={() => runItem(it)}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors disabled:opacity-40"
                      style={{
                        background: isActive ? "rgba(100,181,246,0.12)" : "transparent",
                        color: isActive ? "#e8f1fb" : "#c9cdd6",
                      }}
                    >
                      {it.dotColor ? (
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: it.dotColor }}
                        />
                      ) : (
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-[3px]"
                          style={{ background: isActive ? "#64b5f6" : "#3a3a48" }}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.hint && (
                        <span className="shrink-0 text-[11px] text-neutral-500">
                          {it.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>

        <div
          className="flex items-center gap-3 border-t px-4 py-2 text-[10.5px] text-neutral-600"
          style={{ borderColor: "#20202b" }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
