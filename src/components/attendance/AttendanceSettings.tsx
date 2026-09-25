import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Crosshair, Play, Trash2, Upload } from "lucide-react";
import { Panel } from "@/components/AppShell";
import type { Employee } from "@/lib/hrms";
import { FLAG_LABEL, btnGhost, btnPrimary, db, field, iso, useFlags, useSettings, useShifts, type Settings } from "./shared";

const NUMS: { k: keyof Settings; label: string; hint: string }[] = [
  { k: "grace_minutes", label: "Grace time (min)", hint: "Late after shift start + grace" },
  { k: "late_limit", label: "Lates allowed / month", hint: "Deduction starts after this" },
  { k: "late_deduct_days", label: "Deduction (days)", hint: "From CL, then SL, else unpaid" },
  { k: "buffer_minutes", label: "Buffer (min)", hint: "Staying this long isn't OT" },
  { k: "ot_min_minutes", label: "Minimum OT (min)", hint: "Shorter extra time ignored" },
  { k: "ot_weekday_rate", label: "OT rate · weekday (×)", hint: "Pay multiplier" },
  { k: "ot_holiday_rate", label: "OT rate · holiday / off day (×)", hint: "Pay multiplier" },
  { k: "comp_off_expiry_days", label: "Comp-off expiry (days)", hint: "Unused comp-offs lapse" },
  { k: "weekly_hours_cap", label: "Weekly hours cap", hint: "HR alerted above this" },
  { k: "regularize_hours", label: "Fix-punch window (hours)", hint: "Else day is unpaid" },
  { k: "proxy_days", label: "Manager proxy window (working days)", hint: "Then auto-locked" },
  { k: "absconding_days", label: "Absconding after (days)", hint: "No attendance, no leave" },
  { k: "prorata_min_days", label: "Min days worked / month", hint: "Below this, leave pro-rated" },
];

export function AttendanceSettings({ companyId, employees }: { companyId: string; employees: Employee[] }) {
  const qc = useQueryClient();
  const { data: s } = useSettings(companyId);
  const { data: shifts = [] } = useShifts(companyId);
  const { data: flags = [] } = useFlags();
  const { data: locs = [] } = useQuery({
    queryKey: ["office_locs", companyId],
    queryFn: async () => (await db.from("office_locations").select("*").eq("company_id", companyId).order("name")).data ?? [],
  });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => setForm(s ?? null), [s]);
  const [loc, setLoc] = useState({ name: "", city: "", lat: "", lng: "", radius_m: "200" });
  const [shift, setShift] = useState({ name: "", kind: "regular", start_time: "09:00", end_time: "18:00" });
  const [faceQ, setFaceQ] = useState("");
  const empBy = new Map(employees.map((e) => [e.id, e]));
  const inv = (k: string) => qc.invalidateQueries({ queryKey: [k] });

  const saveSettings = async () => {
    if (!form) return;
    const { error } = await db.from("attendance_settings").upsert({ ...form, company_id: companyId, updated_at: new Date().toISOString() });
    if (error) return void toast.error(error.message);
    toast.success("Rules saved");
    inv("att_settings");
  };
  const addLoc = async () => {
    const { error } = await db.from("office_locations").insert({ company_id: companyId, name: loc.name, city: loc.city, lat: Number(loc.lat), lng: Number(loc.lng), radius_m: Number(loc.radius_m) });
    if (error) return void toast.error(error.message);
    setLoc({ name: "", city: "", lat: "", lng: "", radius_m: "200" });
    inv("office_locs");
  };
  const addShift = async () => {
    const [a = 0, b = 0] = [shift.start_time, shift.end_time].map((t) => Number(t.slice(0, 2)) + Number(t.slice(3)) / 60);
    const { error } = await db.from("shifts").insert({ ...shift, company_id: companyId, hours: Math.round(((b - a + 24) % 24 || 24) * 10) / 10 });
    if (error) return void toast.error(error.message);
    setShift({ name: "", kind: "regular", start_time: "09:00", end_time: "18:00" });
    inv("att_shifts");
  };
  const run = async () => {
    const { error } = await db.rpc("run_attendance_checks");
    if (error) return void toast.error(error.message);
    toast.success("Checks complete");
    inv("att_flags");
  };
  const resolve = async (id: string) => {
    await db.from("attendance_flags").update({ resolved: true }).eq("id", id);
    inv("att_flags");
  };
  const resetFace = async (id: string) => {
    const { error } = await db.from("employee_face_profiles").delete().eq("employee_id", id);
    if (error) return void toast.error(error.message);
    toast.success("Face reset — they'll register again on next punch");
  };
  const importDevice = async (f: File) => {
    const wb = XLSX.read(await f.arrayBuffer());
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!, { raw: false });
    const byKey = new Map<string, string>();
    employees.forEach((e) => { byKey.set(e.email.toLowerCase(), e.id); if (e.employee_code) byKey.set(String(e.employee_code).toLowerCase(), e.id); });
    let skipped = 0;
    const out = rows.flatMap((r) => {
      const v = Object.values(r).map((x) => String(x ?? "").trim());
      const id = byKey.get(v[0]?.toLowerCase() ?? "");
      const d = v[1] ? iso(new Date(v[1])) : "";
      if (!id || !d) { skipped++; return []; }
      const ts = (t: string) => (t ? new Date(`${d}T${t.length === 4 ? `0${t}` : t}`).toISOString() : null);
      return [{ employee_id: id, work_date: d, in_at: ts(v[2] ?? ""), out_at: ts(v[3] ?? ""), source: "device" }];
    });
    for (let i = 0; i < out.length; i += 200) {
      const { error } = await db.from("attendance_days").upsert(out.slice(i, i + 200), { onConflict: "employee_id,work_date" });
      if (error) return void toast.error(error.message);
    }
    toast.success(`${out.length} device records imported${skipped ? ` · ${skipped} skipped` : ""}`);
    inv("att_days");
  };
  const deviceTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([["Employee code or email", "Date (YYYY-MM-DD)", "In (HH:MM)", "Out (HH:MM)"], ["AIO001", iso(new Date()), "09:05", "18:20"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Punches");
    XLSX.writeFile(wb, "device-punch-template.xlsx");
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Panel title="Attendance rules" meta={<button className={btnPrimary} onClick={saveSettings}>Save rules</button>}>
        {form && (
          <div className="p-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              {NUMS.map((n) => (
                <label key={n.k} className="text-[12px]">
                  <span className="font-medium">{n.label}</span>
                  <input type="number" step="0.1" className={field} value={String(form[n.k])} onChange={(e) => setForm({ ...form, [n.k]: Number(e.target.value) })} />
                  <span className="text-[10.5px] text-ink-soft">{n.hint}</span>
                </label>
              ))}
              <label className="text-[12px]"><span className="font-medium">Night window starts</span><input type="time" className={field} value={form.night_start.slice(0, 5)} onChange={(e) => setForm({ ...form, night_start: e.target.value })} /></label>
              <label className="text-[12px]"><span className="font-medium">Night window ends</span><input type="time" className={field} value={form.night_end.slice(0, 5)} onChange={(e) => setForm({ ...form, night_end: e.target.value })} /></label>
            </div>
            <div className="flex flex-wrap gap-4 text-[13px]">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.geofence_required} onChange={(e) => setForm({ ...form, geofence_required: e.target.checked })} />Require office location</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.face_required} onChange={(e) => setForm({ ...form, face_required: e.target.checked })} />Require face match</label>
            </div>
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <Panel title="Alerts for HR" meta={<button className={btnGhost} onClick={run}><Play className="size-3.5" />Run checks now</button>}>
          <div className="divide-y divide-line max-h-72 overflow-auto">
            {flags.length === 0 && <p className="p-4 text-[12.5px] text-ink-soft">No open alerts. Checks cover lates, missed punches, absconding, weekly hours cap, comp-off expiry and pro-rata leave.</p>}
            {flags.map((f) => (
              <div key={f.id} className="px-4 py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium">{empBy.get(f.employee_id)?.full_name ?? "Employee"} · <span className={f.flag === "absconding" ? "text-destructive" : "text-whilter"}>{FLAG_LABEL[f.flag]}</span></p>
                  <p className="text-[11px] text-ink-soft truncate">{f.period} · {f.detail}</p>
                </div>
                <button className="text-[11px] text-brand hover:underline cursor-pointer" onClick={() => resolve(f.id)}>Resolve</button>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Office locations (geo-fence)">
          <div className="divide-y divide-line">
            {(locs as any[]).map((l) => (
              <div key={l.id} className="px-4 py-2 flex items-center gap-2 text-[12.5px]">
                <span className="flex-1">{l.name} <span className="text-ink-soft">· {l.city} · {l.radius_m} m</span></span>
                <button onClick={async () => { await db.from("office_locations").delete().eq("id", l.id); inv("office_locs"); }} className="cursor-pointer text-ink-soft hover:text-destructive" aria-label="Remove"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
            {locs.length === 0 && <p className="px-4 py-3 text-[12px] text-whilter">No offices yet — punches are allowed anywhere until you add one.</p>}
            <div className="p-3 grid grid-cols-2 sm:grid-cols-6 gap-2">
              <input className={`${field} sm:col-span-2`} placeholder="Office name" value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} />
              <input className={field} placeholder="City" value={loc.city} onChange={(e) => setLoc({ ...loc, city: e.target.value })} />
              <input className={field} placeholder="Lat" value={loc.lat} onChange={(e) => setLoc({ ...loc, lat: e.target.value })} />
              <input className={field} placeholder="Lng" value={loc.lng} onChange={(e) => setLoc({ ...loc, lng: e.target.value })} />
              <input className={field} placeholder="Radius m" value={loc.radius_m} onChange={(e) => setLoc({ ...loc, radius_m: e.target.value })} />
              <button className={`${btnGhost} col-span-1 sm:col-span-3 justify-center`} onClick={() => navigator.geolocation?.getCurrentPosition((p) => setLoc({ ...loc, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }))}><Crosshair className="size-3.5" />Use where I am</button>
              <button className={`${btnPrimary} col-span-1 sm:col-span-3 justify-center`} disabled={!loc.name || !loc.lat || !loc.lng} onClick={addLoc}>Add office</button>
            </div>
          </div>
        </Panel>

        <Panel title="Shifts">
          <div className="divide-y divide-line">
            {shifts.map((x) => (
              <div key={x.id} className="px-4 py-2 flex items-center gap-2 text-[12.5px]">
                <span className="flex-1">{x.name} <span className="text-ink-soft">· {x.kind} · {x.start_time.slice(0, 5)}–{x.end_time.slice(0, 5)} · {x.hours}h</span></span>
                <button onClick={async () => { await db.from("shifts").update({ active: !x.active }).eq("id", x.id); inv("att_shifts"); }} className="text-[11px] text-ink-soft hover:underline cursor-pointer">{x.active ? "Disable" : "Enable"}</button>
              </div>
            ))}
            <div className="p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
              <input className={`${field} sm:col-span-2`} placeholder="Shift name" value={shift.name} onChange={(e) => setShift({ ...shift, name: e.target.value })} />
              <select className={field} value={shift.kind} onChange={(e) => setShift({ ...shift, kind: e.target.value })}>
                {["regular", "rotational", "night", "wfh"].map((k) => <option key={k}>{k}</option>)}
              </select>
              <input type="time" className={field} value={shift.start_time} onChange={(e) => setShift({ ...shift, start_time: e.target.value })} />
              <input type="time" className={field} value={shift.end_time} onChange={(e) => setShift({ ...shift, end_time: e.target.value })} />
              <button className={`${btnPrimary} col-span-2 sm:col-span-5 justify-center`} disabled={!shift.name} onClick={addShift}>Add shift</button>
            </div>
          </div>
        </Panel>

        <Panel title="Biometric device logs" meta={<button className={btnGhost} onClick={deviceTemplate}>Template</button>}>
          <div className="p-4 flex items-center gap-3">
            <label className={btnPrimary}><Upload className="size-3.5" />Upload punches<input type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && importDevice(e.target.files[0])} /></label>
            <p className="text-[11.5px] text-ink-soft">Late, overtime and night flags are worked out automatically.</p>
          </div>
        </Panel>

        <Panel title="Reset a face registration">
          <div className="p-3 space-y-2">
            <input className={field} placeholder="Search employee" value={faceQ} onChange={(e) => setFaceQ(e.target.value)} />
            {faceQ.length > 1 && employees.filter((e) => e.company_id === companyId && e.full_name.toLowerCase().includes(faceQ.toLowerCase())).slice(0, 6).map((e) => (
              <div key={e.id} className="flex items-center justify-between text-[12.5px]">
                <span>{e.full_name}</span>
                <button className="text-[11.5px] text-brand hover:underline cursor-pointer" onClick={() => resetFace(e.id)}>Reset face</button>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
