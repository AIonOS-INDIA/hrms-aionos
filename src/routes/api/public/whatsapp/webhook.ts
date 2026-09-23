import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

function signatureValid(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!appSecret) return false;
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const got = Buffer.from(header.slice(7));
  const exp = Buffer.from(expected);
  return got.length === exp.length && timingSafeEqual(got, exp);
}

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      // Meta calls this once to verify the endpoint.
      GET: async ({ request }) => {
        const { whatsappConfig } = await import("@/lib/channels.server");
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge") ?? "";
        const { verifyToken } = whatsappConfig();
        if (mode === "subscribe" && verifyToken && token === verifyToken) {
          return new Response(challenge, { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },

      POST: async ({ request }) => {
        const { whatsappConfig, sendWhatsappText } = await import("@/lib/channels.server");
        const { appSecret } = whatsappConfig();
        const raw = await request.text();

        if (!signatureValid(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const { handleInboundMessage } = await import("@/lib/channel-inbound.server");

        for (const entry of payload?.entry ?? []) {
          for (const change of entry?.changes ?? []) {
            for (const message of change?.value?.messages ?? []) {
              if (message?.type !== "text") continue;
              const from = String(message.from ?? "");
              const text = String(message.text?.body ?? "");
              try {
                const { reply } = await handleInboundMessage({
                  channel: "whatsapp",
                  handle: from,
                  text,
                  externalId: String(message.id ?? ""),
                });
                if (reply) await sendWhatsappText(from, reply);
              } catch (error) {
                console.error("[whatsapp] inbound failed", error);
              }
            }
          }
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
