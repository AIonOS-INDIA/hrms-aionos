import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnboardingCardRequest } from "@/lib/onboarding-card.server";

// POST /api/public/onboarding/decision
// Called by Outlook (not the browser) when the manager clicks Approve or Deny.
// Outlook sends a Microsoft-signed token proving who clicked. We verify it, save the
// decision, tell the requester, and return a new card that replaces the buttons.

type DecisionBody = { requestId?: unknown; action?: unknown; reason?: unknown };

/** Success: the body is a new card that replaces the one in the email. */
function cardResponse(card: unknown) {
  return new Response(JSON.stringify(card), {
    status: 200,
    headers: { "Content-Type": "application/json", "CARD-UPDATE-IN-BODY": "true" },
  });
}

/** Error: no card in the body, only a short message Outlook shows under the buttons. */
function errorResponse(message: string, status = 400) {
  return new Response(null, { status, headers: { "CARD-ACTION-STATUS": message } });
}

/** The token's audience is this server's public address, in either of two forms. */
function expectedAudiences(request: Request) {
  const base = new URL(process.env["APP_PUBLIC_URL"] || new URL(request.url).origin);
  return [base.origin, base.hostname];
}

export const Route = createFileRoute("/api/public/onboarding/decision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { verifyOutlookToken } = await import("@/lib/outlook-token.server");
          const { outcomeCard, sendMail, esc } = await import("@/lib/onboarding-card.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const admin = supabaseAdmin as unknown as SupabaseClient;

          const tenant = process.env["MS_TENANT_ID"];
          const sender = process.env["MS_SENDER_EMAIL"]?.toLowerCase();
          if (!tenant || !sender) {
            console.error("[onboarding] MS_TENANT_ID or MS_SENDER_EMAIL is not set");
            return errorResponse("The approval service is not configured. Contact HR.", 500);
          }

          // 1. Verify the Microsoft-signed token that Outlook attaches to the click.
          const authorization = request.headers.get("Authorization");
          if (!authorization?.startsWith("Bearer "))
            return errorResponse("This action is not authenticated", 401);
          let claims: Record<string, unknown>;
          try {
            claims = await verifyOutlookToken(authorization.slice(7), expectedAudiences(request));
          } catch (err) {
            console.error(
              "[onboarding] rejected Outlook token:",
              err instanceof Error ? err.message : err,
            );
            return errorResponse(
              "This action couldn't be verified. Open the request in the HR portal.",
              401,
            );
          }
          if (String(claims["sender"] ?? "").toLowerCase() !== sender || claims["tid"] !== tenant)
            return errorResponse("This action was not issued by the configured Outlook sender", 403);
          const actor = String(claims["sub"] ?? "").toLowerCase();

          // 2. Read what was clicked.
          let body: DecisionBody;
          try {
            body = await request.json();
          } catch {
            return errorResponse(
              "The reason couldn't be read. Remove any double quotes and try again.",
            );
          }
          const requestId = typeof body.requestId === "string" ? body.requestId : "";
          const action = body.action;
          const reason = typeof body.reason === "string" ? body.reason.trim() : "";
          if (!requestId || (action !== "approve" && action !== "deny"))
            return errorResponse("Invalid decision action");
          if (action === "deny" && !reason) return errorResponse("A denial reason is required");

          // 3. Load the request and check the clicker is the assigned approver.
          const { data: current, error: findError } = await admin
            .from("onboarding_requests")
            .select("*")
            .eq("id", requestId)
            .maybeSingle();
          if (findError) {
            console.error("[onboarding] loading request failed:", findError.message);
            return errorResponse("Something went wrong. Try again in a minute.", 500);
          }
          if (!current) return errorResponse("Request not found", 404);
          if (!actor || actor !== String(current.approver_email).toLowerCase())
            return errorResponse("Only the assigned approver can decide this request", 403);

          // Already decided (for example, clicked twice): just show the outcome.
          if (current.status !== "pending")
            return cardResponse(outcomeCard(current as OnboardingCardRequest));

          // 4. Save the decision. `.eq("status", "pending")` means only one click can win.
          const status = action === "approve" ? "approved" : "rejected";
          const { data: updated, error: updateError } = await admin
            .from("onboarding_requests")
            .update({ status, decision_note: reason || null, decided_by_email: actor })
            .eq("id", current.id)
            .eq("status", "pending")
            .select("*")
            .maybeSingle();
          if (updateError) {
            console.error("[onboarding] saving decision failed:", updateError.message);
            return errorResponse("Something went wrong saving the decision. Try again.", 500);
          }
          if (!updated) {
            // Another click won the race: show whatever is saved now.
            const { data: latest } = await admin
              .from("onboarding_requests")
              .select("*")
              .eq("id", current.id)
              .single();
            return cardResponse(outcomeCard((latest ?? current) as OnboardingCardRequest));
          }

          // 5. Tell the requester. The decision is already saved, so a failed email is logged, not fatal.
          try {
            const { data: requester } = await admin
              .from("employees")
              .select("email")
              .eq("id", updated.requested_by)
              .maybeSingle();
            if (!requester?.email) throw new Error("requester has no email on file");
            const note = updated.decision_note ? ` Reason: ${esc(String(updated.decision_note))}` : "";
            await sendMail(
              String(requester.email),
              `Onboarding request ${status}: ${String(updated.full_name)}`,
              `<p>Your onboarding request for <strong>${esc(String(updated.full_name))}</strong> was ${status}.${note}</p>`,
            );
          } catch (err) {
            console.error(
              `[onboarding] requester notification for ${current.id} failed:`,
              err instanceof Error ? err.message : err,
            );
          }

          return cardResponse(outcomeCard(updated as OnboardingCardRequest));
        } catch (error) {
          console.error("[onboarding] decision failed:", error);
          return errorResponse("Something went wrong. Try again in a minute.", 500);
        }
      },
    },
  },
});