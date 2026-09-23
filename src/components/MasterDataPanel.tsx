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

  const usedCount = (value: string) => {
    const column = SOURCE[field];
    if (!column) return 0;
    return employees.filter(
      (e) =>
        e.company_id === companyId &&
        String(e[column] ?? "").trim().toLowerCase() === value.toLowerCase(),
    ).length;
  };

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
              onClick={() => setField(f.key)}
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

        <div className="rounded-md ring-1 ring-line divide-y divide-line max-h-[360px] overflow-y-auto">
          {values.length === 0 ? (
            <p className="px-3 py-6 text-[13px] text-ink-soft">
              No values yet for this list. Add one, or pull what is already on employee records.
            </p>
          ) : (
            values.map((v) => {
              const used = usedCount(v.value);
              const editing = editId === v.id;
              const fixed = FIXED_FIELDS.includes(field);
              return (
                <div key={v.id} className="px-3 py-2 flex items-center gap-3 flex-wrap">
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
                  <span className="label-mono w-24 text-right">
                    {used ? `${used} people` : "unused"}
                  </span>
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
              );
            })
          )}
        </div>
      </div>
    </Panel>
  );
}
