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
