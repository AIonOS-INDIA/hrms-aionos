/**
 * Server-only: turns an inbound chat message (WhatsApp / Teams) into an
 * assistant reply, acting strictly as the employee who owns that handle.
 */
import { phoneKey, clientForEmployeeLogin, type ChannelId } from "@/lib/channels.server";
import { runAssistantTurn, type AssistantMessage } from "@/lib/assistant.functions";

const HISTORY_LIMIT = 16;

export type InboundResult = { reply: string; linked: boolean };

function joinCodeFrom(text: string): string | null {
  const m = text.match(/\b(?:join|link|connect)\s*[:#-]?\s*(\d{6})\b/i) ?? text.match(/^\s*(\d{6})\s*$/);
  return m?.[1] ?? null;
}

export async function handleInboundMessage(opts: {
  channel: ChannelId;
  handle: string;
  text: string;
  externalId?: string;
}): Promise<InboundResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const text = (opts.text ?? "").trim();
  if (!text) return { reply: "", linked: false };

  const key = opts.channel === "whatsapp" ? phoneKey(opts.handle) : opts.handle.toLowerCase();

  const { data: links } = await supabaseAdmin
    .from("employee_channel_links")
    .select("*, employees!inner(id, full_name, email, phone, status)")
    .eq("channel", opts.channel);
  const rows = (links ?? []) as any[];

  const matches = (row: any) =>
    opts.channel === "whatsapp"
      ? phoneKey(row.handle ?? "") === key && key.length >= 8
      : (row.handle ?? "").toLowerCase() === key;

  let link = rows.find((r) => r.status === "connected" && matches(r));

  // Not connected yet: accept the one-time join code.
  if (!link) {
    const code = joinCodeFrom(text);
    if (!code) {
      return {
        reply:
          "This number is not connected to the HR assistant yet. Open your record in the HR portal, choose Connect WhatsApp and send the 6-digit code shown there.",
        linked: false,
      };
    }
    const pending = rows.find(
      (r) =>
        r.status === "pending" &&
        r.verification_code === code &&
        (!r.code_expires_at || new Date(r.code_expires_at).getTime() > Date.now()),
    );
    if (!pending) {
      return { reply: "That code is not valid any more. Generate a new one in the HR portal.", linked: false };
    }
    const { data: updated, error } = await supabaseAdmin
      .from("employee_channel_links")
      .update({
        handle: opts.channel === "whatsapp" ? opts.handle.replace(/\D+/g, "") : opts.handle,
        status: "connected",
        verification_code: null,
        code_expires_at: null,
        connected_at: new Date().toISOString(),
      })
      .eq("id", pending.id)
      .select("*, employees!inner(id, full_name, email, phone, status)")
      .maybeSingle();
    if (error || !updated) {
      return { reply: "I could not finish connecting this number. Please try again.", linked: false };
    }
    const name = (updated as any).employees?.full_name?.split(" ")[0] ?? "there";
    return {
      reply: `Hi ${name}, you are connected. Ask me things like "how many leave days do I have left?" or "log 8 hours today on client delivery".`,
      linked: true,
    };
  }

  const employee = link.employees as { email: string; full_name: string };

  // Skip duplicate provider deliveries.
  if (opts.externalId) {
    const { data: seen } = await supabaseAdmin
      .from("channel_messages")
      .select("id")
      .eq("link_id", link.id)
      .eq("external_id", opts.externalId)
      .maybeSingle();
    if (seen) return { reply: "", linked: true };
  }

  const { data: history } = await supabaseAdmin
    .from("channel_messages")
    .select("role, content")
    .eq("link_id", link.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  const priorTurns = ((history ?? []) as AssistantMessage[]).slice().reverse();
  const messages: AssistantMessage[] = [...priorTurns, { role: "user", content: text }];

  const session = await clientForEmployeeLogin(employee.email);
  if (!session) {
    return { reply: "I could not verify your account right now. Please try again shortly.", linked: true };
  }

  let reply: string;
  try {
    const result = await runAssistantTurn(
      { supabase: session.supabase, userId: session.userId },
      messages,
      opts.channel === "whatsapp" ? "whatsapp" : "teams",
    );
    reply = result.reply;
  } catch (error) {
    console.error("[channels] assistant failed", error);
    reply = "Something went wrong handling that. Please try again in a moment.";
  }

  await supabaseAdmin.from("channel_messages").insert([
    { link_id: link.id, role: "user", content: text, external_id: opts.externalId ?? null },
    { link_id: link.id, role: "assistant", content: reply },
  ]);
  await supabaseAdmin
    .from("employee_channel_links")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", link.id);

  return { reply, linked: true };
}
