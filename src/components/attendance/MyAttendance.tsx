import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Fingerprint, LogIn, LogOut, MapPin, ScanFace } from "lucide-react";
import { Panel, StatCard, StatusPill } from "@/components/AppShell";
import { enrollFace, punch } from "@/lib/attendance.functions";
import { CameraCapture } from "./CameraCapture";
import {
  KIND_LABEL, btnGhost, btnPrimary, db, field, hhmm, hrs, iso, monthStart, toTs,
  useCompOffs, useDays, useRequests, useSettings, useShifts,
} from "./shared";

function getPos(): Promise<{ lat: number | null; lng: number | null }> {
  return new Promise((res) => {
    if (!navigator.geolocation) return res({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => res({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

export function MyAttendance({ employeeId, companyId }: { employeeId: string; companyId: string }) {
  const qc = useQueryClient();
  const today = iso(new Date());
  const [month, setMonth] = useState(monthStart());
  const monthEnd = iso(new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 0));
  const { data: s } = useSettings(companyId);
  const { data: shifts = [] } = useShifts(companyId);
  const { data: days = [] } = useDays([employeeId], month, monthEnd);
  const { data: todayRows = [] } = useDays([employeeId], today, today);
  const { data: reqs = [] } = useRequests();
  const { data: comps = [] } = useCompOffs(employeeId);
  const { data: face } = useQuery({
    queryKey: ["face_profile", employeeId],
    queryFn: async () => (await db.from("employee_face_profiles").select("employee_id").eq("employee_id", employeeId).maybeSingle()).data,
  });
  const { data: roster = [] } = useQuery({
    queryKey: ["my_roster", employeeId, month],
    queryFn: async () => (await db.from("rosters").select("*").eq("employee_id", employeeId).gte("work_date", month).lte("work_date", monthEnd)).data ?? [],
  });

  const punchFn = useServerFn(punch);
  const enrollFn = useServerFn(enrollFace);
  const [camera, setCamera] = useState<null | "in" | "out" | "enroll">(null);
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<{ date: string; in: string; out: string; reason: string } | null>(null);
  const [ot, setOt] = useState({ date: today, hours: "2", compensation: "pay", reason: "" });

  const t = todayRows[0];
  const mine = reqs.filter((r) => r.employee_id === employeeId);
  const byDate = useMemo(() => new Map(days.map((d) => [d.work_date, d])), [days]);
  const rosterBy = useMemo(() => new Map((roster as any[]).map((r) => [r.work_date, r])), [roster]);
  const todayShift = shifts.find((x) => x.id === (rosterBy.get(today)?.shift_id ?? t?.shift_id)) ?? shifts[0];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["att_days"] });
    qc.invalidateQueries({ queryKey: ["att_requests"] });
  };

  const doPunch = async (kind: "in" | "out", selfie: string | null) => {
    setBusy(true);
    try {
      const pos = s?.geofence_required === false ? { lat: null, lng: null } : await getPos();
      const r = await punchFn({ data: { kind, selfie, ...pos } });
      toast.success(`Punched ${kind} at ${hhmm(r.at)}${r.location ? ` · ${r.location}` : ""}`);
      setCamera(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const start = (kind: "in" | "out") => {
    if (s?.face_required === false) { void doPunch(kind, null); return; }
    setCamera(face ? kind : "enroll");
  };

  const raise = useMutation({
    mutationFn: async (row: Record<string, unknown>) => {
      const { error } = await db.from("attendance_requests").insert({ employee_id: employeeId, raised_by: employeeId, ...row });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Sent to your manager"); setFix(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = async (id: string) => {
    await db.from("attendance_requests").update({ status: "cancelled" }).eq("id", id);
    refresh();
  };

  const present = days.filter((d) => d.in_at).length;
  const lates = days.filter((d) => d.is_late).length;
  const otPending = mine.filter((r) => r.kind !== "regularization" && r.status === "pending").reduce((n, r) => n + r.ot_minutes, 0);
  const compAvail = comps.filter((c) => c.status === "available");
  const regWindowOk = (date: string) => (Date.now() - new Date(`${date}T23:59`).getTime()) / 3600_000 <= (s?.regularize_hours ?? 48);

  // calendar cells
  const first = new Date(month);
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => iso(new Date(first.getFullYear(), first.getMonth(), i + 1)))];

  const tone = (date: string) => {
    const d = byDate.get(date);
    const r = rosterBy.get(date);
    if (d?.status === "missed_punch") return "bg-destructive/10 text-destructive ring-destructive/30";
    if (d?.is_late) return "bg-whilter/15 text-whilter ring-whilter/30";
    if (d?.in_at) return "bg-perp/10 text-perp ring-perp/30";
    if (r?.weekly_off || [0, 6].includes(new Date(date).getDay())) return "bg-line/40 text-ink-soft ring-transparent";
    if (date < today) return "bg-panel text-destructive/80 ring-line";
    return "bg-panel text-ink-soft ring-line";
  };

  return (
    <div className="space-y-4">
      {/* Punch card */}
      <div className="rounded-2xl ring-1 ring-brand/20 bg-gradient-to-br from-brand/10 via-panel to-panel p-5 grid gap-4 md:grid-cols-[1fr_auto] items-center">
        <div>
          <p className="label-mono">Today · {new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}</p>
          <p className="text-4xl font-semibold tracking-tight mt-1">
            {t?.in_at ? (t.out_at ? "Day complete" : "You're in") : "Not punched in"}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-soft">
            <span>Shift: <b className="text-ink">{todayShift ? `${todayShift.name}` : "—"}</b></span>
            <span>In: <b className="text-ink">{hhmm(t?.in_at ?? null)}</b>{t?.is_late && <span className="text-whilter"> · late {t.late_minutes}m</span>}</span>
            <span>Out: <b className="text-ink">{hhmm(t?.out_at ?? null)}</b></span>
            {t?.ot_minutes ? <span className="text-brand">OT {hrs(t.ot_minutes)}</span> : null}
          </div>
          <p className="mt-2 text-[11.5px] text-ink-soft inline-flex items-center gap-3">
            {s?.geofence_required !== false && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />Office location check</span>}
            {s?.face_required !== false && <span className="inline-flex items-center gap-1"><ScanFace className="size-3" />{face ? "Face check" : "Face not registered yet"}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {!t?.in_at ? (
            <button onClick={() => start("in")} disabled={busy} className="h-14 px-6 rounded-2xl bg-brand text-paper text-[15px] font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60 shadow-sm">
              <LogIn className="size-5" /> Punch in
            </button>
          ) : !t.out_at ? (
            <button onClick={() => start("out")} disabled={busy} className="h-14 px-6 rounded-2xl bg-ink text-paper text-[15px] font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60">
              <LogOut className="size-5" /> Punch out
            </button>
          ) : (
            <span className="h-14 px-5 rounded-2xl bg-perp/10 text-perp inline-flex items-center gap-2 text-[14px] font-medium"><Fingerprint className="size-5" />{hrs(t.worked_minutes)} worked</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Days present" value={present} hint="this month" />
        <StatCard label="Late arrivals" value={lates} hint={`${s?.late_limit ?? 3} allowed · then ${s?.late_deduct_days ?? 0.5} day cut`} hintTone={lates > (s?.late_limit ?? 3) ? "warn" : "soft"} />
        <StatCard label="Overtime pending" value={hrs(otPending)} hint="awaiting manager" />
        <StatCard label="Comp-offs" value={compAvail.length} hint={compAvail[0] ? `next expires ${compAvail[compAvail.length - 1]!.expires_on}` : `expire after ${s?.comp_off_expiry_days ?? 30} days`} hintTone="good" />
      </div>

      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4">
        <Panel
          title="My month"
          meta={<input type="month" value={month.slice(0, 7)} onChange={(e) => setMonth(`${e.target.value}-01`)} className={`${field} w-auto`} />}
        >
          <div className="p-3">
            <div className="grid grid-cols-7 gap-1 text-center label-mono mb-1">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((date, i) =>
                date ? (
                  <button
                    key={date}
                    onClick={() => {
                      if (date > today) return;
                      const d = byDate.get(date);
                      setFix({ date, in: d?.in_at ? hhmm(d.in_at) : "09:00", out: d?.out_at ? hhmm(d.out_at) : "18:00", reason: "" });
                    }}
                    className={`aspect-square sm:aspect-[4/3] rounded-lg ring-1 text-[12px] p-1 flex flex-col items-center justify-center cursor-pointer hover:ring-brand ${tone(date)} ${date === today ? "ring-2 ring-brand" : ""}`}
                  >
                    <span className="font-semibold">{Number(date.slice(8))}</span>
                    <span className="text-[9.5px] hidden sm:block">{byDate.get(date)?.in_at ? hrs(byDate.get(date)!.worked_minutes) : rosterBy.get(date)?.weekly_off ? "off" : ""}</span>
                  </button>
                ) : <span key={`e${i}`} />,
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-soft">
              <span><i className="inline-block size-2 rounded bg-perp mr-1" />Present</span>
              <span><i className="inline-block size-2 rounded bg-whilter mr-1" />Late</span>
              <span><i className="inline-block size-2 rounded bg-destructive mr-1" />Missed punch</span>
              <span><i className="inline-block size-2 rounded bg-line mr-1" />Weekly off</span>
              <span>Tap a past day to fix a missed punch</span>
            </div>
          </div>
        </Panel>

        <div className="space-y-4">
          {fix && (
            <Panel title={`Fix attendance · ${fix.date}`}>
              <div className="p-4 space-y-3">
                {!regWindowOk(fix.date) && (
                  <p className="text-[12px] text-destructive">The {s?.regularize_hours ?? 48}h window has passed — this day stays unpaid unless your manager marks it for you.</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[12px]">In<input type="time" className={field} value={fix.in} onChange={(e) => setFix({ ...fix, in: e.target.value })} /></label>
                  <label className="text-[12px]">Out<input type="time" className={field} value={fix.out} onChange={(e) => setFix({ ...fix, out: e.target.value })} /></label>
                </div>
                <input className={field} placeholder="Reason (e.g. forgot to punch out)" value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} />
                <div className="flex gap-2">
                  <button
                    className={btnPrimary}
                    disabled={!fix.reason || !regWindowOk(fix.date) || raise.isPending}
                    onClick={() => raise.mutate({ kind: "regularization", work_date: fix.date, requested_in: toTs(fix.date, fix.in), requested_out: toTs(fix.date, fix.out), reason: fix.reason })}
                  >Send for approval</button>
                  <button className={btnGhost} onClick={() => setFix(null)}>Cancel</button>
                </div>
              </div>
            </Panel>
          )}

          <Panel title="Plan overtime">
            <div className="p-4 grid grid-cols-2 gap-2">
              <input type="date" className={field} value={ot.date} onChange={(e) => setOt({ ...ot, date: e.target.value })} />
              <input type="number" min="0.5" step="0.5" className={field} value={ot.hours} onChange={(e) => setOt({ ...ot, hours: e.target.value })} aria-label="Hours" />
              <div className="col-span-2 grid grid-cols-2 rounded-lg ring-1 ring-line p-0.5">
                {(["pay", "comp_off"] as const).map((c) => (
                  <button key={c} onClick={() => setOt({ ...ot, compensation: c })} className={`h-8 rounded-md text-[12.5px] cursor-pointer ${ot.compensation === c ? "bg-brand text-paper" : ""}`}>
                    {c === "pay" ? "Overtime pay" : "Comp-off"}
                  </button>
                ))}
              </div>
              <input className={`${field} col-span-2`} placeholder="What's the extra work?" value={ot.reason} onChange={(e) => setOt({ ...ot, reason: e.target.value })} />
              <button
                className={`${btnPrimary} col-span-2 justify-center`}
                disabled={!ot.reason || raise.isPending}
                onClick={() => raise.mutate({ kind: "ot_planned", work_date: ot.date, ot_minutes: Math.round(Number(ot.hours) * 60), compensation: ot.compensation, reason: ot.reason, ot_rate: s?.ot_weekday_rate ?? 1 })}
              >Request pre-approval</button>
            </div>
          </Panel>

          <Panel title="My requests">
            <div className="divide-y divide-line max-h-72 overflow-auto">
              {mine.length === 0 && <p className="p-4 text-[12.5px] text-ink-soft">No requests yet.</p>}
              {mine.slice(0, 30).map((r) => (
                <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{KIND_LABEL[r.kind]} · {r.work_date}</p>
                    <p className="text-[11.5px] text-ink-soft truncate">
                      {r.kind === "regularization" ? `${hhmm(r.requested_in)}–${hhmm(r.requested_out)}` : `${hrs(r.ot_minutes)} · ${r.compensation === "pay" ? `pay ×${r.ot_rate}` : "comp-off"}`}
                      {r.decision_note ? ` · ${r.decision_note}` : ""}
                    </p>
                  </div>
                  <StatusPill status={r.status} />
                  {r.status === "pending" && r.kind !== "ot_auto" && (
                    <button className="text-[11px] text-ink-soft hover:underline cursor-pointer" onClick={() => cancel(r.id)}>Cancel</button>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {camera && (
        <CameraCapture
          title={camera === "enroll" ? "Register your face (one time)" : `Punch ${camera}`}
          busy={busy}
          onClose={() => setCamera(null)}
          onCapture={async (img) => {
            if (camera === "enroll") {
              setBusy(true);
              try {
                await enrollFn({ data: { selfie: img } });
                toast.success("Face registered — now punch in");
                qc.invalidateQueries({ queryKey: ["face_profile"] });
                setCamera(t?.in_at ? "out" : "in");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            } else doPunch(camera, img);
          }}
        />
      )}
    </div>
  );
}
