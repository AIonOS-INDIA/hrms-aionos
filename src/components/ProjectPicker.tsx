import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ProjectPicker({
  value,
  options,
  onChange,
  disabled,
  loading,
  label,
  className = "",
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const all = value && !options.includes(value) ? [value, ...options] : options;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = terms.length ? all.filter((o) => terms.every((t) => o.toLowerCase().includes(t))) : all;
    return hits.slice(0, 200);
  }, [q, options, value]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className={`h-9 px-2 rounded-lg bg-panel ring-1 text-[13px] text-left outline-none focus:ring-ink disabled:opacity-60 inline-flex items-center gap-1.5 min-w-0 ${
            value ? "ring-line" : "ring-destructive text-ink-soft"
          } ${className}`}
        >
          <span className="truncate flex-1">
            {value || (loading ? "Loading projects…" : "Project (required)")}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-[min(22rem,calc(100vw-2rem))]">
        <div className="flex items-center gap-2 px-2.5 border-b border-line">
          <Search className="size-3.5 shrink-0 text-ink-soft" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search account or project…"
            className="h-10 flex-1 min-w-0 bg-transparent text-[14px] outline-none"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {list.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-ink-soft">
              {loading ? "Loading projects…" : "No matching projects"}
            </p>
          )}
          {list.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => { onChange(o); setOpen(false); setQ(""); }}
              className="w-full text-left px-2 py-2 rounded-md text-[13px] hover:bg-ink/5 flex items-center gap-2 cursor-pointer"
            >
              <Check className={`size-3.5 shrink-0 ${o === value ? "opacity-100" : "opacity-0"}`} />
              <span className="break-words min-w-0">{o}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
