import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Check, ChevronLeft, ChevronRight, Download, Upload, X } from "lucide-react";
import { Panel, StatCard, StatusPill } from "@/components/AppShell";
import type { Employee } from "@/lib/hrms";
import {
  FLAG_LABEL, KIND_LABEL, btnGhost, btnPrimary, db, field, hhmm, hrs, iso, toTs,
  useDays, useFlags, useRequests, useShifts, type Roster,
} from "./shared";

type Member = { person: Employee; depth: number };

export function TeamAttendance({ members, companyId, isHr, myId }: { members: Member[]; companyId: string; isHr: boolean; myId: string }) {
  const qc = useQueryClient();
  const today = iso(new Date());
  const [tab, setTab] = useState<"today" | "approvals" | "roster" | "alerts">("today");
  const [depth, setDepth] = useState<"direct" | "all">("all");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [proxy, setProxy] = useState<{ emp: Employee; date: string; in: string; out: string; note: string } | null>(null);

  const scoped = members.filter((m) => (depth === "direct" ? m.depth === 1 : true));
  const ids = scoped.map((m) => m.person.id);
  const byId = useMemo(() => new Map(members.map((m) => [m.person.id, m])), [members]);
  const { data: days = [] } = useDays(ids, today, today);
  const { data: reqs = [] } = useRequests();
  const { data: flags = [] } = useFlags();
  const { data: shifts = [] } = useShifts(companyId);
  const { data: leaves = [] } = useQuery({
    queryKey: ["team_leave_today", today],
    queryFn: async () => (await db.from("leave_requests").select("employee_id").eq("status", "approved").lte("start_date", today).gte("end_date", today)).data ?? [],
  });
  const onLeave = new Set((leaves as { employee_id: string }[]).map((l) => l.employee_id));
  const dayBy = new Map(days.map((d) => [d.employee_id, d]));
  const canEdit = (id: string) => isHr || (byId.get(id)?.depth ?? 9) <= 2;

  const status = (e: Employee) => {
    const d = dayBy.get(e.id);
    if (onLeave.has(e.id)) return "on leave";
    if (d?.in_at) return d.is_late ? "late" : "present";
    return "absent";
  };
  const counts = { present: 0, late: 0, absent: 0, "on leave": 0 } as Record<string, number>;
  scoped.forEach((m) => { const k = status(m.person); counts[k] = (counts[k] ?? 0) + 1; });
  const pending = reqs.filter((r) => r.status === "pending" && r.employee_id !== myId && byId.has(r.employee_id));
  const teamFlags = flags.filter((f) => byId.has(f.employee_id));

  const rows = scoped
    .filter((m) => (!filter || status(m.person) === filter || (filter === "ot" && (dayBy.get(m.person.id)?.ot_minutes ?? 0) > 0) || (filter === "night" && dayBy.get(m.person.id)?.is_night)))
    .filter((m) => !q || m.person.full_name.toLowerCase().includes(q.toLowerCase()));

  const decide = async (id: string, decision: "approved" | "rejected", compensation?: string) => {
    const note = decision === "rejected" ? prompt("Reason for rejecting?") ?? "" : "";
    const { error } = await db.rpc("decide_attendance_request", { _id: id, _decision: decision, _note: note, _compensation: compensation ?? "" });
    if (error) return void toast.error(error.message);
    toast.success(decision === "approved" ? "Approved" : "Rejected");
    qc.invalidateQueries({ queryKey: ["att_requests"] });
    qc.invalidateQueries({ queryKey: ["att_days"] });
  };

  const saveProxy = async () => {
    if (!proxy) return;
    const { error } = await db.rpc("proxy_mark_attendance", {
      _employee_id: proxy.emp.id, _date: proxy.date, _in: toTs(proxy.date, proxy.in), _out: toTs(proxy.date, proxy.out), _note: proxy.note,
    });
    if (error) return void toast.error(error.message);
    toast.success(`Attendance marked for ${proxy.emp.full_name}`);
    setProxy(null);
    qc.invalidateQueries({ queryKey: ["att_days"] });
  };

  const Tab = ({ id, label, n }: { id: typeof tab; label: string; n?: number }) => (
    <button onClick={() => setTab(id)} className={`h-9 px-3.5 rounded-full text-[13px] cursor-pointer ${tab === id ? "bg-ink text-paper" : "ring-1 ring-line hover:bg-ink/5"}`}>
      {label}{n ? <span className="ml-1.5 px-1.5 rounded-full bg-brand text-paper text-[10.5px]">{n}</span> : null}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tab id="today" label="Today" />
        <Tab id="approvals" label="Approvals" n={pending.length} />
        <Tab id="roster" label="Roster" />
        <Tab id="alerts" label="Alerts" n={teamFlags.length} />
        <div className="ml-auto flex rounded-full ring-1 ring-line p-0.5 text-[12px]">
          {(["direct", "all"] as const).map((d) => (
            <button key={d} onClick={() => setDepth(d)} className={`h-7 px-3 rounded-full cursor-pointer ${depth === d ? "bg-brand text-paper" : ""}`}>
              {d === "direct" ? "Direct reports" : "Whole team"}
            </button>
          ))}
        </div>
      </div>

      {tab === "today" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {(["present", "late", "absent", "on leave"] as const).map((k) => (
              <StatCard key={k} label={k} value={counts[k] ?? 0} active={filter === k} onClick={() => setFilter(filter === k ? null : k)} />
            ))}
            <StatCard label="Overtime" value={days.filter((d) => d.ot_minutes > 0).length} active={filter === "ot"} onClick={() => setFilter(filter === "ot" ? null : "ot")} />
            <StatCard label="Night shift" value={days.filter((d) => d.is_night).length} active={filter === "night"} onClick={() => setFilter(filter === "night" ? null : "night")} />
          </div>
          <Panel title={`${rows.length} people`} meta={<input className={`${field} w-48`} placeholder="Search name" value={q} onChange={(e) => setQ(e.target.value)} />}>
            <div className="divide-y divide-line">
              {rows.slice(0, 200).map(({ person: e, depth: dp }) => {
                const d = dayBy.get(e.id);
                const st = status(e);
                return (
                  <div key={e.id} className="px-4 py-2.5 grid grid-cols-[1fr_auto] sm:grid-cols-[1.4fr_1fr_1fr_auto] gap-2 items-center">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate">{e.full_name}</p>
                      <p className="text-[11.5px] text-ink-soft truncate">{e.job_title} · {dp === 1 ? "L1" : dp === 2 ? "L2" : `L${dp}`}</p>
                    </div>
                    <p className="hidden sm:block text-[12px] text-ink-soft">{shifts.find((s) => s.id === d?.shift_id)?.name ?? "—"}</p>
                    <p className="hidden sm:block text-[12px]">{hhmm(d?.in_at ?? null)} – {hhmm(d?.out_at ?? null)}{d?.ot_minutes ? <span className="text-brand"> · OT {hrs(d.ot_minutes)}</span> : null}</p>
                    <div className="flex items-center gap-2 justify-end">
                      <StatusPill status={st === "late" ? "pending" : st === "present" ? "approved" : st === "absent" ? "rejected" : "on_leave"} />
                      <span className="text-[11px] w-12 capitalize text-ink-soft hidden md:inline">{st}</span>
                      {canEdit(e.id) && (
                        <button className="text-[11.5px] text-brand hover:underline cursor-pointer" onClick={() => setProxy({ emp: e, date: today, in: "09:00", out: "18:00", note: "" })}>Mark</button>
                      )}
                    </div>
                  </div>
                );
              })}
              {rows.length === 0 && <p className="p-4 text-[12.5px] text-ink-soft">Nobody matches.</p>}
            </div>
          </Panel>
        </>
      )}

      {tab === "approvals" && (
        <Panel title="Waiting for you">
          <div className="divide-y divide-line">
            {pending.length === 0 && <p className="p-4 text-[12.5px] text-ink-soft">All clear — nothing to approve.</p>}
            {pending.map((r) => (
              <ApprovalRow key={r.id} name={byId.get(r.employee_id)?.person.full_name ?? ""} r={r} onDecide={decide} />
            ))}
          </div>
        </Panel>
      )}

      {tab === "roster" && <RosterGrid members={scoped.filter((m) => canEdit(m.person.id))} shifts={shifts} />}

      {tab === "alerts" && (
        <Panel title="Team alerts">
          <div className="divide-y divide-line">
            {teamFlags.length === 0 && <p className="p-4 text-[12.5px] text-ink-soft">No alerts.</p>}
            {teamFlags.map((f) => (
              <div key={f.id} className="px-4 py-2.5">
                <p className="text-[13px] font-medium">{byId.get(f.employee_id)?.person.full_name} · <span className={f.flag === "absconding" ? "text-destructive" : "text-whilter"}>{FLAG_LABEL[f.flag]}</span></p>
                <p className="text-[11.5px] text-ink-soft">{f.period} · {f.detail}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {proxy && (
        <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-3">
          <div className="w-full max-w-sm bg-panel rounded-2xl ring-1 ring-line p-4 space-y-3">
            <p className="text-[14px] font-semibold">Mark attendance for {proxy.emp.full_name}</p>
            <p className="text-[11.5px] text-ink-soft">Allowed for L1/L2 managers within 7 working days. Your name is logged on the record.</p>
            <input type="date" max={today} className={field} value={proxy.date} onChange={(e) => setProxy({ ...proxy, date: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input type="time" className={field} value={proxy.in} onChange={(e) => setProxy({ ...proxy, in: e.target.value })} />
              <input type="time" className={field} value={proxy.out} onChange={(e) => setProxy({ ...proxy, out: e.target.value })} />
            </div>
            <input className={field} placeholder="Note (e.g. client site, device down)" value={proxy.note} onChange={(e) => setProxy({ ...proxy, note: e.target.value })} />
            <div className="flex gap-2 justify-end">
              <button className={btnGhost} onClick={() => setProxy(null)}>Cancel</button>
              <button className={btnPrimary} onClick={saveProxy}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalRow({ name, r, onDecide }: { name: string; r: ReturnType<typeof useRequests>["data"] extends (infer T)[] | undefined ? T : never; onDecide: (id: string, d: "approved" | "rejected", c?: string) => void }) {
  const [comp, setComp] = useState(r.compensation);
  const isOt = r.kind !== "regularization";
  return (
    <div className="px-4 py-3 grid gap-2 sm:grid-cols-[1fr_auto] items-center">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{name} · {KIND_LABEL[r.kind]}</p>
        <p className="text-[12px] text-ink-soft">
          {r.work_date} · {isOt ? `${hrs(r.ot_minutes)} extra · rate ×${r.ot_rate}` : `${hhmm(r.requested_in)} – ${hhmm(r.requested_out)}`}
          {r.reason ? ` · ${r.reason}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {isOt && (
          <select value={comp} onChange={(e) => setComp(e.target.value as typeof comp)} className={`${field} w-auto`}>
            <option value="pay">Pay</option>
            <option value="comp_off">Comp-off</option>
          </select>
        )}
        <button className={`${btnPrimary}`} onClick={() => onDecide(r.id, "approved", comp)}><Check className="size-4" />Approve</button>
        <button className={btnGhost} onClick={() => onDecide(r.id, "rejected")}><X className="size-4" /></button>
      </div>
    </div>
  );
}

function RosterGrid({ members, shifts }: { members: Member[]; shifts: ReturnType<typeof useShifts>["data"] & object }) {
  const qc = useQueryClient();
  const [week, setWeek] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return iso(d);
  });
  const dates = Array.from({ length: 7 }, (_, i) => iso(new Date(new Date(week).getTime() + i * 86400000)));
  const ids = members.map((m) => m.person.id);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState({ shift: shifts[0]?.id ?? "", offs: [5, 6] as number[] });
  const { data: roster = [] } = useQuery({
    queryKey: ["roster", week, ids.length],
    enabled: ids.length > 0,
    queryFn: async () => ((await db.from("rosters").select("*").gte("work_date", dates[0]).lte("work_date", dates[6]).in("employee_id", ids.slice(0, 300))).data ?? []) as Roster[],
  });
  const key = (e: string, d: string) => `${e}|${d}`;
  const map = new Map(roster.map((r) => [key(r.employee_id, r.work_date), r]));

  const save = async (rows: { employee_id: string; work_date: string; shift_id: string | null; weekly_off: boolean }[]) => {
    const { error, data } = await db.rpc("set_roster", { _rows: rows });
    if (error) return void toast.error(error.message);
    toast.success(`${data} roster days saved`);
    qc.invalidateQueries({ queryKey: ["roster"] });
  };
  const cell = (e: string, d: string, v: string) =>
    save([{ employee_id: e, work_date: d, shift_id: v === "off" ? null : v, weekly_off: v === "off" }]);
  const applyBulk = () => {
    const targets = sel.size ? [...sel] : ids;
    save(targets.flatMap((e) => dates.map((d, i) => ({ employee_id: e, work_date: d, shift_id: bulk.offs.includes(i) ? null : bulk.shift, weekly_off: bulk.offs.includes(i) }))));
  };
  const shiftWeek = (n: number) => setWeek(iso(new Date(new Date(week).getTime() + n * 7 * 86400000)));

  const template = () => {
    const ws = XLSX.utils.aoa_to_sheet([["Employee email", "Date (YYYY-MM-DD)", "Shift name or OFF"], ...members.slice(0, 3).map((m) => [m.person.email, dates[0], shifts[0]?.name ?? ""])]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Roster");
    XLSX.writeFile(wb, "roster-template.xlsx");
  };
  const upload = async (f: File) => {
    const wb = XLSX.read(await f.arrayBuffer());
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!, { raw: false });
    const byEmail = new Map(members.map((m) => [m.person.email.toLowerCase(), m.person.id]));
    const byName = new Map(shifts.map((s) => [s.name.toLowerCase(), s.id]));
    const bad: string[] = [];
    const rows = data.flatMap((r, i) => {
      const v = Object.values(r).map((x) => String(x ?? "").trim());
      const e = byEmail.get(v[0]?.toLowerCase() ?? "");
      const off = v[2]?.toUpperCase() === "OFF";
      const s = byName.get(v[2]?.toLowerCase() ?? "");
      const d = v[1] ? iso(new Date(v[1])) : "";
      if (!e || !d || (!off && !s)) { bad.push(`row ${i + 2}`); return []; }
      return [{ employee_id: e, work_date: d, shift_id: off ? null : s!, weekly_off: off }];
    });
    if (bad.length) toast.warning(`Skipped ${bad.length}: ${bad.slice(0, 5).join(", ")} (unknown person/shift or not in your team)`);
    if (rows.length) save(rows);
  };

  return (
    <Panel
      title="Weekly roster"
      meta={
        <div className="flex items-center gap-1">
          <button className={btnGhost} onClick={() => shiftWeek(-1)} aria-label="Previous week"><ChevronLeft className="size-4" /></button>
          <span className="text-[12.5px] px-2">{dates[0]} → {dates[6]}</span>
          <button className={btnGhost} onClick={() => shiftWeek(1)} aria-label="Next week"><ChevronRight className="size-4" /></button>
        </div>
      }
    >
      <div className="p-3 border-b border-line flex flex-wrap items-center gap-2 bg-brand/[0.03]">
        <span className="text-[12px] font-medium">Fill week for {sel.size || "everyone"}:</span>
        <select className={`${field} w-auto`} value={bulk.shift} onChange={(e) => setBulk({ ...bulk, shift: e.target.value })}>
          {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="text-[12px] text-ink-soft">Weekly off:</span>
        {["M", "T", "W", "T", "F", "S", "S"].map((l, i) => (
          <button key={i} onClick={() => setBulk({ ...bulk, offs: bulk.offs.includes(i) ? bulk.offs.filter((x) => x !== i) : [...bulk.offs, i] })}
            className={`size-7 rounded-full text-[11px] cursor-pointer ${bulk.offs.includes(i) ? "bg-ink text-paper" : "ring-1 ring-line"}`}>{l}</button>
        ))}
        <button className={btnPrimary} onClick={applyBulk}>Apply</button>
        <div className="ml-auto flex gap-2">
          <button className={btnGhost} onClick={template}><Download className="size-3.5" />Template</button>
          <label className={btnGhost}><Upload className="size-3.5" />Upload<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[760px]">
          <thead>
            <tr className="label-mono text-left">
              <th className="px-3 py-2"><input type="checkbox" checked={sel.size === ids.length && ids.length > 0} onChange={(e) => setSel(e.target.checked ? new Set(ids) : new Set())} /></th>
              <th className="px-2 py-2">Person</th>
              {dates.map((d) => <th key={d} className="px-1 py-2">{new Date(d).toLocaleDateString([], { weekday: "short", day: "numeric" })}</th>)}
            </tr>
          </thead>
          <tbody>
            {members.slice(0, 150).map(({ person: e }) => (
              <tr key={e.id} className="border-t border-line">
                <td className="px-3"><input type="checkbox" checked={sel.has(e.id)} onChange={() => { const n = new Set(sel); n.has(e.id) ? n.delete(e.id) : n.add(e.id); setSel(n); }} /></td>
                <td className="px-2 py-1.5 whitespace-nowrap">{e.full_name}</td>
                {dates.map((d) => {
                  const r = map.get(key(e.id, d));
                  const v = r ? (r.weekly_off ? "off" : r.shift_id ?? "") : "";
                  return (
                    <td key={d} className="px-1 py-1">
                      <select value={v} onChange={(x) => cell(e.id, d, x.target.value)}
                        className={`h-8 w-full rounded-md text-[11.5px] px-1 ring-1 outline-none cursor-pointer ${v === "off" ? "bg-line/50 ring-transparent text-ink-soft" : v ? "bg-brand/10 ring-brand/20" : "bg-panel ring-line text-ink-soft"}`}>
                        <option value="">—</option>
                        {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        <option value="off">Off</option>
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
            {members.length === 0 && <tr><td colSpan={9} className="p-4 text-ink-soft">No L1/L2 reportees to roster.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
