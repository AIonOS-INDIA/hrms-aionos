import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel, useScope } from "@/components/AppShell";
import { useEmployees, useMe } from "@/lib/hrms";

type Head = { id: string; company_id: string; department: string; head_employee_id: string };

/** Functional heads: one named head per department, per entity. */
export function DepartmentHeadsPanel() {
  const { data: me } = useMe();
  const { companyId, companyById } = useScope();
  const { data: employees = [] } = useEmployees();
  const queryClient = useQueryClient();
  const allowed = me?.isMaster ? null : new Set(me?.hrCompanyIds ?? []);
  const [entity, setEntity] = useState(companyId ?? me?.hrCompanyIds[0] ?? "");
  const [dept, setDept] = useState("");
  const [search, setSearch] = useState("");
  const [headId, setHeadId] = useState("");
  const target = companyId ?? entity;

  const { data: heads = [] } = useQuery({
    queryKey: ["department_heads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department_heads" as never).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as Head[];
    },
  });

  const inEntity = useMemo(() => employees.filter((e) => e.company_id === target), [employees, target]);
  const departments = useMemo(
    () => Array.from(new Set(inEntity.map((e) => e.department).filter(Boolean))).sort(),
    [inEntity],
  );
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return inEntity
      .filter((e) => e.status !== "offboarded" && (e.full_name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [inEntity, search]);
  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "—";
  const shown = heads.filter((h) => h.company_id === target);

  const save = useMutation({
    mutationFn: async () => {
      if (!target || !dept || !headId) throw new Error("Pick the department and the head");
      const { error } = await supabase
        .from("department_heads" as never)
        .upsert({ company_id: target, department: dept, head_employee_id: headId } as never, {
          onConflict: "company_id,department",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Functional head saved");
      setDept("");
      setSearch("");
      setHeadId("");
      queryClient.invalidateQueries({ queryKey: ["department_heads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("department_heads" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["department_heads"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const cls = "w-full h-9 px-2.5 rounded-md ring-1 ring-line bg-paper text-[13px]";
  const entityOptions = (me?.isMaster ? employees.map((e) => e.company_id) : me?.hrCompanyIds ?? [])
    .filter((v, i, a) => a.indexOf(v) === i && (!allowed || allowed.has(v)));

  return (
    <Panel title="Functional heads">
      <div className="p-4 space-y-3">
        <p className="text-[12px] text-ink-soft">
          The head of each department approves resignations after HR and receives escalations.
        </p>
        {!companyId && (
          <select value={entity} onChange={(e) => setEntity(e.target.value)} className={cls}>
            <option value="">Choose entity…</option>
            {entityOptions.map((id) => (
              <option key={id} value={id}>
                {companyById(id)?.name ?? id}
              </option>
            ))}
          </select>
        )}
        {target && (
          <>
            <ul className="space-y-1">
              {shown.length === 0 && <li className="text-[12px] text-ink-soft">No heads set yet.</li>}
              {shown.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="min-w-0 truncate">
                    <b>{h.department}</b> · {empName(h.head_employee_id)}
                  </span>
                  <button
                    onClick={() => remove.mutate(h.id)}
                    className="size-6 grid place-items-center rounded hover:bg-ink/5 cursor-pointer"
                    aria-label="Remove"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <select value={dept} onChange={(e) => setDept(e.target.value)} className={cls}>
              <option value="">Department…</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setHeadId("");
              }}
              placeholder="Search the head by name or email"
              className={cls}
            />
            {matches.length > 0 && !headId && (
              <ul className="rounded-md ring-1 ring-line max-h-48 overflow-auto">
                {matches.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => {
                        setHeadId(e.id);
                        setSearch(e.full_name);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-[12.5px] hover:bg-brand/5 cursor-pointer"
                    >
                      {e.full_name} <span className="text-ink-soft">· {e.job_title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-60"
            >
              Save functional head
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}
