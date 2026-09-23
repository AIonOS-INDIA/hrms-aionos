import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ChatApproval = {
  kind: "leave" | "timesheet";
  id: string;
  employeeName: string;
  headline: string;
  detail: string;
};

/**
 * Everything waiting on the signed-in HR / finance approver, ready to be
 * actioned straight from the assistant chat. RLS keeps this to their entities.
 */
export const getChatApprovals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChatApproval[]> => {
    const supabase = (context as any).supabase;

    const { data: mine } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", (context as any).userId)
      .maybeSingle();
    const myEmployeeId = mine?.id ?? "";

    const [{ data: leave }, { data: sheets }] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("id, employee_id, start_date, end_date, days, reason, employees!inner(full_name)")
        .eq("status", "pending")
        .order("start_date", { ascending: true })
        .limit(25),
      supabase
        .from("timesheets")
        .select("id, employee_id, week_start, total_hours, status, finance_status, employees!inner(full_name)")
        .in("status", ["submitted", "approved"])
        .order("week_start", { ascending: true })
        .limit(25),
    ]);

    const out: ChatApproval[] = [];

    for (const r of (leave ?? []) as any[]) {
      if (r.employee_id === myEmployeeId) continue;
      out.push({
        kind: "leave",
        id: r.id,
        employeeName: r.employees?.full_name ?? "Team member",
        headline: `Leave · ${r.days} day${Number(r.days) === 1 ? "" : "s"}`,
        detail: `${r.start_date} to ${r.end_date}${r.reason ? ` · ${r.reason}` : ""}`,
      });
    }

    for (const t of (sheets ?? []) as any[]) {
      if (t.employee_id === myEmployeeId) continue;
      const needsHr = t.status === "submitted";
      const needsFinance = t.status === "approved" && t.finance_status === "pending";
      if (!needsHr && !needsFinance) continue;
      out.push({
        kind: "timesheet",
        id: t.id,
        employeeName: t.employees?.full_name ?? "Team member",
        headline: `${needsHr ? "Timesheet" : "Finance sign-off"} · ${Number(t.total_hours)}h`,
        detail: `Week of ${t.week_start}`,
      });
    }

    return out.slice(0, 20);
  });

export const decideChatApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: z.enum(["leave", "timesheet"]),
        id: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<{ message: string }> => {
    const supabase = (context as any).supabase;
    const now = new Date().toISOString();

    if (data.kind === "leave") {
      const { error } = await supabase
        .from("leave_requests")
        .update({ status: data.decision, decided_at: now })
        .eq("id", data.id)
        .eq("status", "pending");
      if (error) throw new Error(error.message);
      return { message: `Leave request ${data.decision}.` };
    }

    const { data: sheet, error: readError } = await supabase
      .from("timesheets")
      .select("id, status, finance_status")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!sheet) throw new Error("That timesheet is no longer available.");

    if (sheet.status === "submitted") {
      const { error } = await supabase
        .from("timesheets")
        .update({ status: data.decision, decided_at: now })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { message: `Timesheet ${data.decision}.` };
    }

    const { error } = await supabase
      .from("timesheets")
      .update({ finance_status: data.decision, finance_decided_at: now })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { message: `Finance ${data.decision === "approved" ? "signed off" : "sent back"}.` };
  });
