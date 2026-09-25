import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any;

export type Settings = {
  company_id: string;
  grace_minutes: number;
  late_limit: number;
  late_deduct_days: number;
  buffer_minutes: number;
  ot_min_minutes: number;
  ot_weekday_rate: number;
  ot_holiday_rate: number;
  comp_off_expiry_days: number;
  weekly_hours_cap: number;
  night_start: string;
  night_end: string;
  geofence_required: boolean;
  face_required: boolean;
  regularize_hours: number;
  proxy_days: number;
  absconding_days: number;
  prorata_min_days: number;
};
export type Shift = { id: string; company_id: string; name: string; kind: string; start_time: string; end_time: string; hours: number; active: boolean };
export type Day = {
  id: string; employee_id: string; work_date: string; shift_id: string | null; in_at: string | null; out_at: string | null;
  source: string; is_late: boolean; late_minutes: number; worked_minutes: number; ot_minutes: number; is_night: boolean;
  is_off_day: boolean; status: string; note: string; marked_by: string | null;
};
export type Req = {
  id: string; employee_id: string; kind: "regularization" | "ot_planned" | "ot_auto"; work_date: string;
  requested_in: string | null; requested_out: string | null; ot_minutes: number; ot_rate: number;
  compensation: "pay" | "comp_off"; reason: string; status: string; decision_note: string; created_at: string;
};
export type Roster = { id: string; employee_id: string; work_date: string; shift_id: string | null; weekly_off: boolean };
export type Flag = { id: string; employee_id: string; flag: string; period: string; detail: string; resolved: boolean; created_at: string };
export type CompOff = { id: string; employee_id: string; earned_on: string; expires_on: string; status: string };

export const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const hhmm = (ts: string | null) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
export const hrs = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
export const toTs = (date: string, time: string) => (time ? new Date(`${date}T${time}`).toISOString() : null);
export const monthStart = (d = new Date()) => iso(new Date(d.getFullYear(), d.getMonth(), 1));

export const KIND_LABEL: Record<string, string> = {
  regularization: "Missed punch fix",
  ot_planned: "Planned overtime",
  ot_auto: "Overtime (auto)",
};
export const FLAG_LABEL: Record<string, string> = {
  absconding: "Absent without leave",
  hours_cap: "Over weekly hours cap",
  late_deduction: "Late-coming deduction",
  missed_punch: "Missed punch",
  prorata: "Pro-rata leave",
};

export function useSettings(companyId?: string | null) {
  return useQuery({
    queryKey: ["att_settings", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await db.from("attendance_settings").select("*").eq("company_id", companyId).maybeSingle();
      return (data ?? null) as Settings | null;
    },
  });
}
export function useShifts(companyId?: string | null) {
  return useQuery({
    queryKey: ["att_shifts", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await db.from("shifts").select("*").eq("company_id", companyId).order("start_time");
      return (data ?? []) as Shift[];
    },
  });
}
export function useDays(ids: string[] | null, from: string, to: string) {
  return useQuery({
    queryKey: ["att_days", ids?.length ?? "all", ids?.[0], from, to],
    enabled: ids === null || ids.length > 0,
    queryFn: () =>
      fetchAll<Day>(() => {
        let q = db.from("attendance_days").select("*").gte("work_date", from).lte("work_date", to).order("work_date").order("id");
        if (ids && ids.length <= 300) q = q.in("employee_id", ids);
        return q;
      }),
  });
}
export function useRequests() {
  return useQuery({
    queryKey: ["att_requests"],
    queryFn: async () => {
      const { data } = await db.from("attendance_requests").select("*").order("created_at", { ascending: false }).limit(500);
      return (data ?? []) as Req[];
    },
  });
}
export function useFlags() {
  return useQuery({
    queryKey: ["att_flags"],
    queryFn: async () => {
      const { data } = await db.from("attendance_flags").select("*").eq("resolved", false).order("created_at", { ascending: false }).limit(300);
      return (data ?? []) as Flag[];
    },
  });
}
export function useCompOffs(employeeId?: string) {
  return useQuery({
    queryKey: ["att_compoffs", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data } = await db.from("comp_offs").select("*").eq("employee_id", employeeId).order("earned_on", { ascending: false });
      return (data ?? []) as CompOff[];
    },
  });
}

export const btn = "h-9 px-3 rounded-lg text-[13px] font-medium cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5";
export const btnPrimary = `${btn} bg-brand text-paper hover:opacity-90`;
export const btnGhost = `${btn} ring-1 ring-line hover:bg-ink/5`;
export const field = "h-9 px-2 rounded-lg bg-panel ring-1 ring-line text-[13px] outline-none focus:ring-ink w-full";
