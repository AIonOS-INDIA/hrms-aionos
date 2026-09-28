import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  kind: z.enum(["leave", "timesheet", "expense"]),
  id: z.string().uuid(),
});

export const queueApprovalCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ context, data }) => {
    const table = data.kind === "leave" ? "leave_requests" : data.kind === "timesheet" ? "timesheets" : "expense_claims";
    const { data: item } = await (context as any).supabase.from(table).select("id, employee_id").eq("id", data.id).maybeSingle();
    if (!item) return { sent: 0 };
    const { data: owner } = await (context as any).supabase.from("employees").select("user_id").eq("id", item.employee_id).maybeSingle();
    if (owner?.user_id !== (context as any).userId) return { sent: 0 };
    const request = getRequest();
    const baseUrl = process.env["APP_PUBLIC_URL"] ?? (request ? new URL(request.url).origin : "");
    if (!baseUrl) return { sent: 0 };
    const { dispatchApprovalCards } = await import("@/lib/actionable-cards.server");
    return dispatchApprovalCards(data.kind, data.id, baseUrl);
  });

export const sendOutlookApprovalTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = (context as any).supabase;
    const { data: reportingChain, error: managerError } = await supabase.rpc("my_reporting_chain");
    if (managerError) throw new Error(managerError.message);
    const manager = (reportingChain ?? []).find((row: any) => row.depth === 1);
    if (!manager?.email) throw new Error("Your reporting manager has no email address on file.");

    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("full_name")
      .eq("user_id", (context as any).userId)
      .maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    if (!employee) throw new Error("No employee record is linked to this login.");

    const portalUrl = process.env["APP_PUBLIC_URL"];
    if (!portalUrl || new URL(portalUrl).protocol !== "https:") {
      throw new Error("Set APP_PUBLIC_URL to the public HTTPS app URL first.");
    }
    const { sendStandardOutlookApprovalTestEmail: sendTestEmail } = await import("@/lib/actionable-cards.server");
    await sendTestEmail(manager.email, employee.full_name, `${portalUrl.replace(/\/$/, "")}/leave`);
    return { sent: true };
  });
