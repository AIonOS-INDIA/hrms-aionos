import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// POST /api/public/leave/notify
// Called by the Leave page right after an employee applies. Emails the employee's
// manager an Outlook card with Approve / Deny. The leave request itself is already saved.
// Uses the employee's own login (no service role key): the database function
// leave_notify_context returns their request and their manager's email.

type NotifyBody = { requestId?: unknown };
type NotifyResult = { ok: boolean; managerName?: string; message?: string; error?: string };
type NotifyContext = {
  request_id: string;
  leave_status: string;
  start_on: string;
  end_on: string;
  day_count: number | string;
  leave_reason: string | null;
  leave_type_name: string | null;
  employee_name: string | null;
  manager_name: string | null;
  manager_email: string | null;
  manager_status: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: NotifyResult, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function decisionUrl(request: Request) {
  const base = process.env["APP_PUBLIC_URL"] || new URL(request.url).origin;
  return `${base.replace(/\/$/, "")}/api/public/leave/decision`;
}

export const Route = createFileRoute("/api/public/leave/notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
          const publishable =
            process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
          if (!url || !publishable) {
            console.error("[leave] SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not set");
            return json({ ok: false, message: "Leave saved, but the approval service is not configured." });
          }

          // 1. The employee's login token, sent by the Leave page.
          const auth = request.headers.get("Authorization");
          if (!auth?.startsWith("Bearer ")) return json({ ok: false, error: "Authentication required" }, 401);

          let body: NotifyBody;
          try {
            body = await request.json();
          } catch {
            return json({ ok: false, error: "Invalid request" }, 400);
          }
          const requestId = typeof body.requestId === "string" ? body.requestId : "";
          if (!UUID_RE.test(requestId)) return json({ ok: false, error: "Missing leave request" }, 400);

          // 2. Read the request and the manager as the employee (database checks it is theirs).
          const asEmployee = createClient(url, publishable, {
            global: { headers: { Authorization: auth } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data, error } = await asEmployee.rpc("leave_notify_context", { p_request_id: requestId });
          if (error) {
            console.error("[leave] leave_notify_context failed:", error.message);
            return json({ ok: false, message: `Leave saved, but the approval email could not be sent: ${error.message}` });
          }
          const leave = (Array.isArray(data) ? data[0] : data) as NotifyContext | undefined;
          if (!leave) return json({ ok: false, error: "Leave request not found" }, 404);
          if (leave.leave_status !== "pending")
            return json({ ok: false, error: "Only pending requests can be sent for approval" }, 400);

          // 3. The manager.
          if (!leave.manager_email)
            return json({
              ok: false,
              message: "No manager with an email is assigned to you, so no approval email was sent. HR can review it in the portal.",
            });
          if (leave.manager_status === "offboarded")
            return json({ ok: false, message: "Your manager is no longer active, so no approval email was sent." });

          // 4. Send the card.
          try {
            const { sendMail } = await import("@/lib/outlook-mail.server");
            const { leaveCardHtml } = await import("@/lib/leave-card.server");
            const card = {
              id: String(leave.request_id),
              employee_name: String(leave.employee_name ?? "Employee"),
              leave_type: String(leave.leave_type_name ?? "Leave"),
              start_date: String(leave.start_on),
              end_date: String(leave.end_on),
              days: Number(leave.day_count),
              reason: leave.leave_reason ? String(leave.leave_reason) : null,
              status: String(leave.leave_status),
              manager_email: String(leave.manager_email),
            };
            await sendMail(
              card.manager_email,
              `Leave approval: ${card.employee_name} (${card.start_date} to ${card.end_date})`,
              leaveCardHtml(card, decisionUrl(request)),
            );
            return json({ ok: true, managerName: String(leave.manager_name ?? "your manager") });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[leave] approval email for ${requestId} failed:`, message);
            return json({ ok: false, message: `Leave saved, but the approval email could not be sent: ${message}` });
          }
        } catch (error) {
          console.error("[leave] notify failed:", error);
          return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
        }
      },
    },
  },
});