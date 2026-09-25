import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AssistantMessage } from "@/lib/assistant.functions";

export type ChannelState = {
  channel: "whatsapp" | "microsoft_teams";
  status: "not_linked" | "pending" | "connected";
  handle: string;
  connectedAt: string | null;
  lastMessageAt: string | null;
  code: string | null;
  codeExpiresAt: string | null;
};

export type ChannelsView = {
  phone: string;
  whatsappReady: boolean;
  whatsappNumber: string;
  teamsReady: boolean;
  outlookReady: boolean;
  outlookConnected: boolean;
  channels: ChannelState[];
};

async function myEmployee(context: any) {
  const { data, error } = await context.supabase
    .from("employees")
    .select("id, full_name, email, phone")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No employee record is linked to this login.");
  return data as { id: string; full_name: string; email: string; phone: string };
}

function toState(
  channel: "whatsapp" | "microsoft_teams",
  row: any,
  mask: (v: string) => string,
): ChannelState {
  if (!row || row.status === "revoked") {
    return {
      channel,
      status: "not_linked",
      handle: "",
      connectedAt: null,
      lastMessageAt: null,
      code: null,
      codeExpiresAt: null,
    };
  }
  const pending = row.status === "pending";
  return {
    channel,
    status: pending ? "pending" : "connected",
    handle: row.handle ? mask(row.handle) : "",
    connectedAt: row.connected_at,
    lastMessageAt: row.last_message_at,
    code: pending ? row.verification_code : null,
    codeExpiresAt: pending ? row.code_expires_at : null,
  };
}

export const getMyChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChannelsView> => {
    const emp = await myEmployee(context);
    const { maskHandle, whatsappConfig, whatsappReady } = await import("@/lib/channels.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("employee_channel_links")
      .select("*")
      .eq("employee_id", emp.id);
    const rows = (data ?? []) as any[];
    const { data: connections } = await supabaseAdmin
      .from("app_user_connections")
      .select("connector_id")
      .eq("user_id", (context as any).userId);
    return {
      phone: emp.phone ?? "",
      whatsappReady: whatsappReady(),
      whatsappNumber: whatsappConfig().businessNumber,
      teamsReady: Boolean(process.env["MICROSOFT_TEAMS_APP_USER_CONNECTOR_CLIENT_API_KEY"]),
      outlookReady: Boolean(process.env["MICROSOFT_OUTLOOK_APP_USER_CONNECTOR_CLIENT_API_KEY"]),
      outlookConnected: (connections ?? []).some((row: any) => row.connector_id === "microsoft_outlook"),
      channels: [
        toState("whatsapp", rows.find((r) => r.channel === "whatsapp"), maskHandle),
        toState("microsoft_teams", rows.find((r) => r.channel === "microsoft_teams"), (v) => v),
      ],
    };
  });

export type WhatsappInvite = {
  code: string;
  expiresAt: string;
  joinLink: string;
  qrDataUrl: string;
  ready: boolean;
  phone: string;
};

/** Creates (or refreshes) the one-time code + QR the employee scans in WhatsApp. */
export const startWhatsappLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsappInvite> => {
    const emp = await myEmployee(context);
    const phone = (emp.phone ?? "").trim();

    const { newVerificationCode, onlyDigits, whatsappJoinLink, whatsappReady } = await import(
      "@/lib/channels.server"
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const code = newVerificationCode();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { error } = await supabaseAdmin.from("employee_channel_links").upsert(
      {
        employee_id: emp.id,
        channel: "whatsapp",
        handle: onlyDigits(phone),
        status: "pending",
        verification_code: code,
        code_expires_at: expiresAt,
        connected_at: null,
      },
      { onConflict: "employee_id,channel" },
    );
    if (error) throw new Error(error.message);

    // When the company WhatsApp number is live the code opens WhatsApp directly.
    // Until then the same QR opens the assistant chat in the app on their phone.
    const { getRequest } = await import("@tanstack/react-start/server");
    let origin = "";
    try {
      const req = getRequest();
      origin = req ? new URL(req.url).origin : "";
    } catch {
      origin = "";
    }
    const joinLink = whatsappJoinLink(code) || (origin ? `${origin}/profile#assistant` : "");
    const QRCode = (await import("qrcode")).default;
    const qrDataUrl = await QRCode.toDataURL(joinLink || `JOIN ${code}`, {
      margin: 1,
      width: 320,
      color: { dark: "#0b3b3c", light: "#ffffff" },
    });

    return { code, expiresAt, joinLink, qrDataUrl, ready: whatsappReady(), phone };
  });

export const disconnectChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ channel: z.enum(["whatsapp", "microsoft_teams"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const emp = await myEmployee(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("employee_channel_links")
      .delete()
      .eq("employee_id", emp.id)
      .eq("channel", data.channel);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type ChatTurn = { role: "user" | "assistant"; content: string; at: string };

const HISTORY = 30;

/** Finds (or opens) the employee's WhatsApp thread row. */
async function whatsappLinkFor(
  admin: any,
  employeeId: string,
  phone: string,
): Promise<{ id: string; status: string; handle: string } | null> {
  const { data: existing } = await admin
    .from("employee_channel_links")
    .select("id, status, handle")
    .eq("employee_id", employeeId)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (existing) return existing;
  if (!phone.trim()) return null;
  const { onlyDigits } = await import("@/lib/channels.server");
  const { data: created, error } = await admin
    .from("employee_channel_links")
    .insert({
      employee_id: employeeId,
      channel: "whatsapp",
      handle: onlyDigits(phone),
      status: "pending",
    })
    .select("id, status, handle")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return created;
}

/** The employee's own WhatsApp conversation, newest last. */
export const getWhatsappThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChatTurn[]> => {
    const emp = await myEmployee(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link } = await supabaseAdmin
      .from("employee_channel_links")
      .select("id")
      .eq("employee_id", emp.id)
      .eq("channel", "whatsapp")
      .maybeSingle();
    if (!link) return [];
    const { data } = await supabaseAdmin
      .from("channel_messages")
      .select("role, content, created_at")
      .eq("link_id", link.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY);
    return ((data ?? []) as any[])
      .reverse()
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content, at: m.created_at }));
  });

/**
 * Sends one message to the HR assistant in the employee's WhatsApp thread.
 * Used by the in-app chat, and mirrored to WhatsApp when the number is live,
 * so the conversation is the same wherever they pick it up.
 */
export const sendWhatsappChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ text: z.string().min(1).max(2000) }).parse(d))
  .handler(async ({ context, data }): Promise<{ reply: string; delivered: boolean }> => {
    const emp = await myEmployee(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runAssistantTurn } = await import("@/lib/assistant.functions");
    const { sendWhatsappText, whatsappReady } = await import("@/lib/channels.server");

    const link = await whatsappLinkFor(supabaseAdmin, emp.id, emp.phone ?? "");

    let history: AssistantMessage[] = [];
    if (link) {
      const { data: rows } = await supabaseAdmin
        .from("channel_messages")
        .select("role, content")
        .eq("link_id", link.id)
        .order("created_at", { ascending: false })
        .limit(16);
      history = ((rows ?? []) as AssistantMessage[]).slice().reverse();
    }

    const text = data.text.trim();
    const { reply } = await runAssistantTurn(
      { supabase: (context as any).supabase, userId: (context as any).userId },
      [...history, { role: "user", content: text }],
      "whatsapp",
    );

    let delivered = false;
    if (link) {
      await supabaseAdmin.from("channel_messages").insert([
        { link_id: link.id, role: "user", content: text },
        { link_id: link.id, role: "assistant", content: reply },
      ]);
      await supabaseAdmin
        .from("employee_channel_links")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", link.id);
      if (link.status === "connected" && whatsappReady()) {
        delivered = await sendWhatsappText(link.handle, reply);
      }
    }
    return { reply, delivered };
  });
