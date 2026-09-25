import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/AppShell";
import {
  MASTER_FIELDS,
  useEmployees,
  useEntityFieldValues,
  type Employee,
  type MasterField,
} from "@/lib/hrms";

/** Employee column that feeds a mastered list, where one exists. */
const SOURCE: Partial<Record<MasterField, keyof Employee>> = {
  job_title: "job_title",
  band: "band",
  department: "department",
  business_unit: "business_unit",
  legal_entity: "legal_entity",
  location: "location",
  office_city: "office_city",
  office_area: "office_area",
  employment_type: "employment_type",
  employment_status: "status",
  gender: "gender",
};

/** Lists whose values are fixed database options and cannot be renamed. */
const FIXED_FIELDS: MasterField[] = ["employment_type", "employment_status", "gender"];

export function MasterDataPanel({
  companyId,
  companyName,
  canEdit,
}: {
  companyId: string | undefined;
  companyName: string;
  canEdit: boolean;
}) {
  const { data: rows = [] } = useEntityFieldValues();
  const { data: employees = [] } = useEmployees();
  const queryClient = useQueryClient();
  const [field, setField] = useState<MasterField>("job_title");
  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState("");
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [moveTo, setMoveTo] = useState("");

  const values = useMemo(
    () =>
      rows
        .filter((r) => r.company_id === companyId && r.field === field)
        .sort((a, b) => a.value.localeCompare(b.value)),
    [rows, companyId, field],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["entity_field_values"] });

  const add = useMutation({
    mutationFn: async (value: string) => {
      if (!companyId) throw new Error("Pick an entity first");
      const clean = value.trim();
      if (!clean) throw new Error("Type a value first");
      if (values.some((v) => v.value.toLowerCase() === clean.toLowerCase()))
        throw new Error("That value is already in the list");
      const { error } = await supabase
        .from("entity_field_values")
        .insert({ company_id: companyId, field, value: clean });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft("");
      refresh();
      toast.success("Value added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async (v: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from("entity_field_values")
        .update({ active: v.active })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("entity_field_values").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Value removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: async ({ id, from, to }: { id: string; from: string; to: string }) => {
      const clean = to.trim();
      if (!clean) throw new Error("Type a value first");
      if (clean === from) return 0;
      if (FIXED_FIELDS.includes(field))
        throw new Error("This list uses fixed system options and cannot be renamed");
      if (values.some((v) => v.id !== id && v.value.toLowerCase() === clean.toLowerCase()))
        throw new Error("That value is already in the list");
      const { error } = await supabase
        .from("entity_field_values")
        .update({ value: clean })
        .eq("id", id);
      if (error) throw error;

      const column = SOURCE[field];
      let moved = 0;
      if (column && companyId) {
        const affected = employees.filter(
          (e) =>
            e.company_id === companyId &&
            String(e[column] ?? "").trim().toLowerCase() === from.toLowerCase(),
        );
        if (affected.length) {
          const { error: upErr } = await supabase
            .from("employees")
            .update({ [column]: clean } as never)
            .in(
              "id",
              affected.map((e) => e.id),
            );
          if (upErr) throw upErr;
          moved = affected.length;
        }
      }
      return moved;
    },
    onSuccess: (moved) => {
      setEditId(null);
      setEditValue("");
      refresh();
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(
        moved ? `Value updated on ${moved} employee record${moved === 1 ? "" : "s"}` : "Value updated",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pullFromPeople = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("Pick an entity first");
      const column = SOURCE[field];
      if (!column) throw new Error("This list is not stored on employee records");
      const known = new Set(values.map((v) => v.value.toLowerCase()));
      const found = new Map<string, string>();
      for (const e of employees) {
        if (e.company_id !== companyId) continue;
        const raw = String(e[column] ?? "").trim();
        if (!raw || known.has(raw.toLowerCase()) || found.has(raw.toLowerCase())) continue;
        found.set(raw.toLowerCase(), raw);
      }
      if (found.size === 0) return 0;
      const { error } = await supabase.from("entity_field_values").insert(
        [...found.values()].map((value) => ({ company_id: companyId, field, value })),
      );
      if (error) throw error;
      return found.size;
    },
    onSuccess: (n) => {
      refresh();
      toast.success(n ? `${n} value${n === 1 ? "" : "s"} added from employee records` : "Nothing new to add");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const merge = useMutation({
    mutationFn: async ({ ids, target }: { ids: string[]; target: string }) => {
      if (!companyId) throw new Error("Pick an entity first");
      const clean = target.trim();
      if (!clean) throw new Error("Type the value to merge into");
      if (FIXED_FIELDS.includes(field)) throw new Error("This list uses fixed system options");
      const sources = values.filter((v) => ids.includes(v.id));
      if (!sources.length) throw new Error("Tick the values to merge first");
      let targetRow = values.find((v) => v.value.toLowerCase() === clean.toLowerCase());
      if (!targetRow) {
        const { error } = await supabase
          .from("entity_field_values")
          .insert({ company_id: companyId, field, value: clean });
        if (error) throw error;
      }
      const fromSet = new Set(
        sources.map((s) => s.value.toLowerCase()).filter((v) => v !== clean.toLowerCase()),
      );
      const column = SOURCE[field];
      let moved = 0;
      if (column) {
        const affected = employees
          .filter(
            (e) =>
              e.company_id === companyId &&
              fromSet.has(String(e[column] ?? "").trim().toLowerCase()),
          )
          .map((e) => e.id);
        for (let i = 0; i < affected.length; i += 200) {
          const { error } = await supabase
            .from("employees")
            .update({ [column]: clean } as never)
            .in("id", affected.slice(i, i + 200));
          if (error) throw error;
        }
        moved = affected.length;
      }
      if (field === "department") {
        const { data: heads } = await supabase
          .from("department_heads" as never)
          .select("id,department")
          .eq("company_id", companyId);
        const list = (heads ?? []) as unknown as { id: string; department: string }[];
        let hasTarget = list.some((h) => h.department.toLowerCase() === clean.toLowerCase());
        for (const h of list) {
          if (!fromSet.has(h.department.toLowerCase())) continue;
          if (hasTarget) {
            await supabase.from("department_heads" as never).delete().eq("id", h.id);
          } else {
            await supabase
              .from("department_heads" as never)
              .update({ department: clean } as never)
              .eq("id", h.id);
            hasTarget = true;
          }
        }
      }
      const drop = sources.filter((s) => s.value.toLowerCase() !== clean.toLowerCase()).map((s) => s.id);
      if (drop.length) {
        const { error } = await supabase.from("entity_field_values").delete().in("id", drop);
        if (error) throw error;
      }
      targetRow = undefined;
      return { moved, merged: drop.length };
    },
    onSuccess: ({ moved, merged }) => {
      setSelected([]);
      setMergeTarget("");
      refresh();
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["department_heads"] });
      toast.success(`Merged ${merged} value${merged === 1 ? "" : "s"} · ${moved} employee record${moved === 1 ? "" : "s"} updated`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const peopleFor = (value: string) => {
    const column = SOURCE[field];
    if (!column) return [];
    return employees
      .filter(
        (e) =>
          e.company_id === companyId &&
          String(e[column] ?? "").trim().toLowerCase() === value.toLowerCase(),
      )
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  };

  const move = useMutation({
    mutationFn: async ({ ids, to }: { ids: string[]; to: string }) => {
      const column = SOURCE[field];
      if (!column) throw new Error("This list is not stored on employee records");
      if (!ids.length) throw new Error("Tick the people to move first");
      if (!to) throw new Error("Pick the new value");
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase
          .from("employees")
          .update({ [column]: to } as never)
          .in("id", ids.slice(i, i + 200));
        if (error) throw error;
      }
      return ids.length;
    },
    onSuccess: (n) => {
      setPicked([]);
      setMoveTo("");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(`${n} employee record${n === 1 ? "" : "s"} updated`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const usedCount = (value: string) => {
    const column = SOURCE[field];
    if (!column) return 0;
    return employees.filter(
      (e) =>
        e.company_id === companyId &&
        String(e[column] ?? "").trim().toLowerCase() === value.toLowerCase(),
    ).length;
  };
  const fixedField = FIXED_FIELDS.includes(field);
  const shownValues = filter.trim()
    ? values.filter((v) => v.value.toLowerCase().includes(filter.trim().toLowerCase()))
    : values;

  return (
    <Panel
      title="Master data"
      meta={
        <span className="label-mono">
          {companyName ? `${companyName} · ` : ""}
          {values.filter((v) => v.active).length} active
        </span>
      }
    >
      <div className="p-4 space-y-3">
        <p className="text-[13px] text-ink-soft">
          These lists fill the dropdowns on employee records for this entity. Edit a value to rename
          it everywhere it is used, or switch it off to stop offering it without touching people who
          already have it.
        </p>

        <div className="flex flex-wrap gap-1.5">
          {MASTER_FIELDS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setField(f.key);
                setSelected([]);
                setFilter("");
              }}
              className={`h-8 px-3 rounded-full text-[12px] ring-1 cursor-pointer ${
                field === f.key
                  ? "bg-brand text-paper ring-brand"
                  : "ring-line hover:bg-ink/5 text-ink-soft"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add.mutate(draft);
                }
              }}
              placeholder="Add a new value"
              aria-label="New value"
              className="flex-1 min-w-[200px] h-9 px-3 rounded-md ring-1 ring-line bg-panel text-[13px]"
            />
            <button
              type="button"
              onClick={() => add.mutate(draft)}
              disabled={add.isPending || !companyId}
              className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-medium disabled:opacity-40 cursor-pointer"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => pullFromPeople.mutate()}
              disabled={pullFromPeople.isPending || !companyId}
              className="h-9 px-3 rounded-md ring-1 ring-line text-[13px] hover:bg-ink/5 disabled:opacity-40 cursor-pointer"
            >
              {pullFromPeople.isPending ? "Reading…" : "Pull from employee records"}
            </button>
          </div>
        ) : null}

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter this list"
          aria-label="Filter values"
          className="w-full h-9 px-3 rounded-md ring-1 ring-line bg-panel text-[13px]"
        />

        {canEdit && !fixedField ? (
          <div className="rounded-md bg-brand/5 ring-1 ring-brand/20 p-3 space-y-2">
            <p className="text-[12px] text-ink-soft">
              <b>Clean up:</b> tick the values that mean the same thing, then merge them into one
              name (an existing value or a new one). Every employee record using them is updated.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                list="merge-targets"
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                placeholder="Merge into…"
                aria-label="Merge into"
                className="flex-1 min-w-[180px] h-9 px-3 rounded-md ring-1 ring-line bg-panel text-[13px]"
              />
              <datalist id="merge-targets">
                {values.map((v) => (
                  <option key={v.id} value={v.value} />
                ))}
              </datalist>
              <button
                type="button"
                disabled={merge.isPending || selected.length === 0 || !mergeTarget.trim()}
                onClick={() => {
                  const n = values
                    .filter((v) => selected.includes(v.id))
                    .reduce((s, v) => s + usedCount(v.value), 0);
                  if (confirm(`Merge ${selected.length} value(s) into "${mergeTarget.trim()}"? ${n} employee record(s) will be updated.`))
                    merge.mutate({ ids: selected, target: mergeTarget });
                }}
                className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-medium disabled:opacity-40 cursor-pointer"
              >
                {merge.isPending ? "Merging…" : `Merge ${selected.length || ""} selected`}
              </button>
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  className="h-9 px-3 rounded-md ring-1 ring-line text-[13px] hover:bg-ink/5 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        ) : null}

        <div className="rounded-md ring-1 ring-line divide-y divide-line max-h-[420px] overflow-y-auto">
          {shownValues.length === 0 ? (
            <p className="px-3 py-6 text-[13px] text-ink-soft">
              No values yet for this list. Add one, or pull what is already on employee records.
            </p>
          ) : (
            shownValues.map((v) => {
              const used = usedCount(v.value);
              const editing = editId === v.id;
              const fixed = fixedField;
              return (
                <div key={v.id}>
                <div className="px-3 py-2 flex items-center gap-3 flex-wrap">
                  {canEdit && !fixed && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${v.value}`}
                      checked={selected.includes(v.id)}
                      onChange={(e) =>
                        setSelected((s) => (e.target.checked ? [...s, v.id] : s.filter((x) => x !== v.id)))
                      }
                      className="size-4 accent-brand cursor-pointer"
                    />
                  )}
                  {editing ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          rename.mutate({ id: v.id, from: v.value, to: editValue });
                        }
                        if (e.key === "Escape") setEditId(null);
                      }}
                      aria-label="Edit value"
                      className="flex-1 min-w-[180px] h-8 px-2.5 rounded-md ring-1 ring-line bg-panel text-[13px]"
                    />
                  ) : (
                    <span
                      className={`flex-1 min-w-[140px] text-[13px] ${v.active ? "" : "text-ink-soft line-through"}`}
                    >
                      {v.value}
                    </span>
                  )}
                  {used ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenId(openId === v.id ? null : v.id);
                        setPicked([]);
                        setMoveTo("");
                      }}
                      className="label-mono w-28 text-right text-brand hover:underline cursor-pointer"
                    >
                      {used} people {openId === v.id ? "▴" : "▾"}
                    </button>
                  ) : (
                    <span className="label-mono w-28 text-right">unused</span>
                  )}
                  {canEdit ? (
                    editing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => rename.mutate({ id: v.id, from: v.value, to: editValue })}
                          disabled={rename.isPending}
                          className="h-7 px-2.5 rounded-md text-[12px] bg-brand text-paper disabled:opacity-40 cursor-pointer"
                        >
                          {rename.isPending ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditId(null)}
                          className="h-7 px-2.5 rounded-md text-[12px] ring-1 ring-line hover:bg-ink/5 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditId(v.id);
                            setEditValue(v.value);
                          }}
                          disabled={fixed}
                          title={fixed ? "This list uses fixed system options" : "Edit this value"}
                          className="h-7 px-2.5 rounded-md text-[12px] ring-1 ring-line hover:bg-ink/5 disabled:opacity-40 cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle.mutate({ id: v.id, active: !v.active })}
                          className="h-7 px-2.5 rounded-md text-[12px] ring-1 ring-line hover:bg-ink/5 cursor-pointer"
                        >
                          {v.active ? "Switch off" : "Switch on"}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove.mutate(v.id)}
                          disabled={used > 0}
                          title={used > 0 ? "In use by employee records" : "Remove"}
                          className="h-7 px-2.5 rounded-md text-[12px] ring-1 ring-line hover:bg-ink/5 disabled:opacity-40 cursor-pointer"
                        >
                          Remove
                        </button>
                      </>
                    )
                  ) : null}
                </div>
                {openId === v.id && (
                  <PeopleList
                    people={peopleFor(v.value)}
                    canMove={canEdit && !fixed}
                    picked={picked}
                    setPicked={setPicked}
                    moveTo={moveTo}
                    setMoveTo={setMoveTo}
                    options={values.filter((o) => o.id !== v.id && o.active).map((o) => o.value)}
                    pending={move.isPending}
                    onMove={() => move.mutate({ ids: picked, to: moveTo })}
                  />
                )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Panel>
  );
}

function PeopleList({
  people,
  canMove,
  picked,
  setPicked,
  moveTo,
  setMoveTo,
  options,
  pending,
  onMove,
}: {
  people: Employee[];
  canMove: boolean;
  picked: string[];
  setPicked: (v: string[]) => void;
  moveTo: string;
  setMoveTo: (v: string) => void;
  options: string[];
  pending: boolean;
  onMove: () => void;
}) {
  const [q, setQ] = useState("");
  const shown = q.trim()
    ? people.filter((p) =>
        `${p.full_name} ${p.email} ${p.job_title}`.toLowerCase().includes(q.trim().toLowerCase()),
      )
    : people;
  const allPicked = shown.length > 0 && shown.every((p) => picked.includes(p.id));
  return (
    <div className="mx-3 mb-3 rounded-md ring-1 ring-line bg-brand/5 p-3 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search these people"
          className="flex-1 min-w-[160px] h-8 px-2.5 rounded-md ring-1 ring-line bg-panel text-[12.5px]"
        />
        {canMove && (
          <>
            <select
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              className="h-8 px-2 rounded-md ring-1 ring-line bg-panel text-[12.5px] max-w-[200px]"
            >
              <option value="">Move ticked to…</option>
              {options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Move ${picked.length} people to "${moveTo}"?`)) onMove();
              }}
              disabled={pending || !picked.length || !moveTo}
              className="h-8 px-3 rounded-md bg-brand text-paper text-[12px] font-medium disabled:opacity-40 cursor-pointer"
            >
              {pending ? "Updating…" : `Update ${picked.length || ""}`}
            </button>
          </>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-line rounded bg-panel ring-1 ring-line">
        {canMove && shown.length > 0 && (
          <label className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={(e) =>
                setPicked(
                  e.target.checked
                    ? Array.from(new Set([...picked, ...shown.map((p) => p.id)]))
                    : picked.filter((id) => !shown.some((p) => p.id === id)),
                )
              }
              className="size-4 accent-brand"
            />
            Select all shown ({shown.length})
          </label>
        )}
        {shown.map((p) => (
          <label key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] cursor-pointer">
            {canMove && (
              <input
                type="checkbox"
                checked={picked.includes(p.id)}
                onChange={(e) =>
                  setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))
                }
                className="size-4 accent-brand"
              />
            )}
            <span className="flex-1 min-w-0 truncate">
              <b className="font-medium">{p.full_name}</b>
              <span className="text-ink-soft"> · {p.job_title || "—"} · {p.email}</span>
            </span>
            {p.status === "offboarded" && <span className="label-mono">left</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
