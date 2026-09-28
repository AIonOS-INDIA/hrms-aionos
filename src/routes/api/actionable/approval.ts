import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/actionable/approval")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        const { verifyApprovalActionToken } = await import("@/lib/actionable-cards.server");
        const payload = verifyApprovalActionToken(token);
        if (!payload) return page("This approval link is invalid or expired.", 400);
        if (payload.kind !== "leave" || payload.decision !== "rejected") {
          return page("Use the approval action in Outlook to record this decision.", 200);
        }
        return rejectionForm(token);
      },
      POST: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token") ?? "";
        const { verifyApprovalActionToken, applyApprovalDecision } = await import("@/lib/actionable-cards.server");
        const payload = verifyApprovalActionToken(token);
        if (!payload) {
          return new Response("Invalid or expired approval link", {
            status: 400,
            headers: { "CARD-ACTION-STATUS": "This approval link is invalid or expired." },
          });
        }
        try {
          let decisionNote = "";
          if (payload.kind === "leave" && payload.decision === "rejected") {
            if (request.headers.get("content-type")?.includes("application/json")) {
              const body = (await request.json()) as { reason?: unknown };
              decisionNote = typeof body.reason === "string" ? body.reason.trim() : "";
            } else {
              const formData = await request.formData();
              decisionNote = String(formData.get("reason") ?? "").trim();
            }
          }
          await applyApprovalDecision(payload, decisionNote);
          if (payload.kind === "leave") {
            const decisionText = payload.decision === "approved" ? "Leave request approved" : "Leave request rejected";
            return new Response(JSON.stringify({
              type: "AdaptiveCard",
              $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
              version: "1.2",
              body: [
                { type: "TextBlock", text: "AIONOS HR approval", weight: "Bolder", size: "Medium" },
                { type: "TextBlock", text: decisionText, wrap: true },
                ...(decisionNote ? [{ type: "TextBlock", text: `Reason: ${decisionNote}`, wrap: true, isSubtle: true }] : []),
              ],
            }), {
              status: 200,
              headers: {
                "content-type": "application/json",
                "CARD-ACTION-STATUS": `${decisionText}. Employee notified.`,
                "CARD-UPDATE-IN-BODY": "true",
              },
            });
          }
          return new Response("Decision recorded.", {
            status: 200,
            headers: { "CARD-ACTION-STATUS": "Decision recorded." },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not apply this decision.";
          return new Response(message, {
            status: 403,
            headers: { "CARD-ACTION-STATUS": message },
          });
        }
      },
    },
  },
});

function rejectionForm(token: string): Response {
  const action = `/api/actionable/approval?token=${encodeURIComponent(token)}`;
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reject leave request — AIONOS HR</title><style>body{font-family:system-ui;max-width:42rem;margin:4rem auto;padding:0 1.5rem;color:#17211b}label{display:block;margin:1.5rem 0 .5rem;font-weight:600}textarea{box-sizing:border-box;width:100%;min-height:9rem;padding:.75rem;font:inherit}button{margin-top:1rem;padding:.7rem 1rem;background:#146c5a;color:white;border:0;border-radius:4px;font:inherit;cursor:pointer}</style></head><body><h1>AIONOS HR</h1><h2>Reject leave request</h2><form method="post" action="${action}"><label for="reason">Reason for rejection</label><textarea id="reason" name="reason" maxlength="1000" required></textarea><button type="submit">Reject request</button></form></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function page(message: string, status: number): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AIONOS HR approval</title></head><body style="font-family:system-ui;max-width:42rem;margin:4rem auto;padding:0 1.5rem;color:#17211b"><h1>AIONOS HR</h1><p>${message.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!)}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
