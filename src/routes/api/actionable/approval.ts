import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/actionable/approval")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token") ?? "";
        const { verifyApprovalActionToken, applyApprovalDecision } = await import("@/lib/actionable-cards.server");
        const payload = verifyApprovalActionToken(token);
        if (!payload) return page("This approval link is invalid or expired.", 400);
        try {
          const result = await applyApprovalDecision(payload);
          return page(`Done: ${result}. You can close this window.`, 200);
        } catch (error) {
          return page(error instanceof Error ? error.message : "Could not apply this decision.", 403);
        }
      },
      POST: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token") ?? "";
        const { verifyApprovalActionToken, applyApprovalDecision } = await import("@/lib/actionable-cards.server");
        const payload = verifyApprovalActionToken(token);
        if (!payload) return new Response("Invalid or expired approval link", { status: 400 });
        try {
          await applyApprovalDecision(payload);
          return new Response(null, { status: 204 });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : "Could not apply this decision.", { status: 403 });
        }
      },
    },
  },
});

function page(message: string, status: number): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AIONOS HR approval</title></head><body style="font-family:system-ui;max-width:42rem;margin:4rem auto;padding:0 1.5rem;color:#17211b"><h1>AIONOS HR</h1><p>${message.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!)}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
