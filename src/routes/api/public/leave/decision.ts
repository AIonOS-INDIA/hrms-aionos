import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { LeaveCardData } from "@/lib/leave-card.server";

// POST /api/public/leave/decision
// Called by Outlook when the manager clicks Approve or Deny on a leave card.
// Verifies the Microsoft-signed token, then asks the database function
// leave_decide_from_outlook (protected by OUTLOOK_DECISION_SECRET) to record the decision.
// No service role key is used.

type DecisionBody = { requestId?: unknown; action?: unknown; reason?: unknown };
type DecisionRow = {
  outcome: "decided" | "already_decided" | "not_manager" | "not_found";
  leave_status: string | null;
  start_on: string | null;
  end_on: string | null;
  day_count: number | string | null;
  leave_reason: string | null;
  leave_type_name: string | null;
  employee_name: string | null;
  employee_email: string | null;
  manager_email: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cardResponse(card: unknown) {
  return new Response(JSON.stringify(card), {
    status: 200,
    headers: { "Content-Type": "application/json", "CARD-UPDATE-IN-BODY": "true" },
  });
}

function errorResponse(message: string, status = 400) {
  return new Response(null, { status, headers: { "CARD-ACTION-STATUS": message } });
}

function expectedAudiences(request: Request) {
  const base = new URL(process.env["APP_PUBLIC_URL"] || new URL(request.url).origin);
  return [base.origin, base.hostname];
}

export const Route = createFileRoute("/api/public/leave/decision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { verifyOutlookToken } = await import("@/lib/outlook-token.server");
          const { sendMail, esc } = await import("@/lib/outlook-mail.server");
          const { leaveOutcomeCard } = await import("@/lib/leave-card.server");

          const tenant = process.env["MS_TENANT_ID"];
          const sender = process.env["MS_SENDER_EMAIL"]?.toLowerCase();
          const secret = process.env["OUTLOOK_DECISION_SECRET"];
          const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
          const publishable =
            process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
          if (!tenant || !sender || !secret || !url || !publishable) {
            console.error("[leave] a required environment variable is not set");
            return errorResponse("The approval service is not configured. Contact HR.", 500);
          }

          // 1. Verify the Microsoft-signed token.
          const authorization = request.headers.get("Authorization");
          if (!authorization?.startsWith("Bearer "))
            return errorResponse("This action is not authenticated", 401);
          let claims: Record<string, unknown>;
          try {
            claims = await verifyOutlookToken(authorization.slice(7), expectedAudiences(request));
          } catch (err) {
            console.error("[leave] rejected Outlook token:", err instanceof Error ? err.message : err);
            return errorResponse("This action couldn't be verified. Open the request in the HR portal.", 401);
          }
          if (String(claims["sender"] ?? "").toLowerCase() !== sender || claims["tid"] !== tenant)
            return errorResponse("This action was not issued by the configured Outlook sender", 403);
          const actor = String(claims["sub"] ?? "").toLowerCase();
          if (!actor) return errorResponse("This action couldn't be verified.", 401);

          // 2. What was clicked?
          let body: DecisionBody;
          try {
            body = await request.json();
          } catch {
            return errorResponse("The reason couldn't be read. Remove any double quotes and try again.");
          }
          const requestId = typeof body.requestId === "string" ? body.requestId : "";
          const action = body.action;
          const reason = typeof body.reason === "string" ? body.reason.trim() : "";
          if (!UUID_RE.test(requestId) || (action !== "approve" && action !== "deny"))
            return errorResponse("Invalid decision action");
          if (action === "deny" && !reason) return errorResponse("A denial reason is required");

          // 3. Record the decision in the database (checks the manager, only one click wins).
          const db = createClient(url, publishable, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data, error } = await db.rpc("leave_decide_from_outlook", {
            p_secret: secret,
            p_request_id: requestId,
            p_actor_email: actor,
            p_decision: action === "approve" ? "approved" : "rejected",
            p_reason: reason || null,
          });
          if (error) {
            console.error("[leave] leave_decide_from_outlook failed:", error.message);
            return errorResponse("Something went wrong saving the decision. Try again.", 500);
          }
          const row = (Array.isArray(data) ? data[0] : data) as DecisionRow | undefined;
          if (!row || row.outcome === "not_found") return errorResponse("Leave request not found", 404);
          if (row.outcome === "not_manager")
            return errorResponse("Only this employee's manager can decide this request", 403);

          const card: LeaveCardData = {
            id: requestId,
            employee_name: String(row.employee_name ?? "Employee"),
            leave_type: String(row.leave_type_name ?? "Leave"),
            start_date: String(row.start_on ?? ""),
            end_date: String(row.end_on ?? ""),
            days: Number(row.day_count ?? 0),
            reason: row.leave_reason ? String(row.leave_reason) : null,
            status: String(row.leave_status ?? ""),
            manager_email: String(row.manager_email ?? ""),
          };

          // Already decided or cancelled: just show the current state.
          if (row.outcome !== "decided") return cardResponse(leaveOutcomeCard(card));

          // 4. Tell the employee (the decision is saved, so a failed email is only logged).
          try {
            if (!row.employee_email) throw new Error("employee has no email on file");
            const word = card.status === "approved" ? "approved" : "denied";
            const note = reason && card.status === "rejected" ? ` Reason: ${esc(reason)}` : "";
            await sendMail(
              String(row.employee_email),
              `Leave ${word}: ${card.start_date} to ${card.end_date}`,
              `<p>Your ${esc(card.leave_type)} from ${esc(card.start_date)} to ${esc(card.end_date)} was <strong>${word}</strong>.${note}</p>`,
            );
          } catch (err) {
            console.error(`[leave] employee notification for ${requestId} failed:`, err instanceof Error ? err.message : err);
          }

          return cardResponse(leaveOutcomeCard(card, card.status === "rejected" ? reason : undefined));
        } catch (error) {
          console.error("[leave] decision failed:", error);
          return errorResponse("Something went wrong. Try again in a minute.", 500);
        }
      },
    },
  },
});