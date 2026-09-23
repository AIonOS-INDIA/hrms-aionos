/**
 * Server-only helpers for chat channels (WhatsApp, Microsoft Teams).
 * Never import this from browser code — it reads server secrets.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ChannelId = "whatsapp" | "microsoft_teams";

export function onlyDigits(value: string): string {
  return (value ?? "").replace(/\D+/g, "");
}

/** Last 10 digits — stable across country-code formatting differences. */
export function phoneKey(value: string): string {
  const d = onlyDigits(value);
  return d.slice(-10);
}

export function maskHandle(value: string): string {
  const d = onlyDigits(value);
  if (d.length < 4) return value;
  return `••• ••• ${d.slice(-4)}`;
}

export function newVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function whatsappConfig() {
  return {
    token: process.env["WHATSAPP_TOKEN"] ?? "",
    phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"] ?? "",
    businessNumber: onlyDigits(process.env["WHATSAPP_BUSINESS_NUMBER"] ?? ""),
    verifyToken: process.env["WHATSAPP_VERIFY_TOKEN"] ?? "",
    appSecret: process.env["WHATSAPP_APP_SECRET"] ?? "",
  };
}

export function whatsappReady(): boolean {
  const c = whatsappConfig();
  return Boolean(c.token && c.phoneNumberId && c.businessNumber);
}

/** Deep link that opens a chat with the HR number, pre-filled with the join code. */
export function whatsappJoinLink(code: string): string {
  const { businessNumber } = whatsappConfig();
  const text = encodeURIComponent(`JOIN ${code}`);
  return businessNumber ? `https://wa.me/${businessNumber}?text=${text}` : "";
}

export async function sendWhatsappText(toDigits: string, body: string): Promise<boolean> {
  const { token, phoneNumberId } = whatsappConfig();
  if (!token || !phoneNumberId) return false;
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: onlyDigits(toDigits),
      type: "text",
      text: { body: body.slice(0, 3500) },
    }),
  });
  if (!res.ok) {
    console.error("[whatsapp] send failed", res.status, await res.text());
    return false;
  }
  return true;
}

/**
 * Builds a Supabase client that acts as the given employee's login, so every
 * assistant action keeps the exact same permissions they have in the app.
 */
export async function clientForEmployeeLogin(
  email: string,
): Promise<{ supabase: SupabaseClient; userId: string } | null> {
  const url = process.env["SUPABASE_URL"];
  const publishable = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !publishable) return null;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const hashedToken = (data as any)?.properties?.hashed_token as string | undefined;
  if (error || !hashedToken) {
    console.error("[channels] could not mint a session", error?.message);
    return null;
  }

  const anon = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await anon.auth.verifyOtp({ token_hash: hashedToken, type: "email" });
  const session = verified.data?.session;
  if (verified.error || !session) {
    console.error("[channels] session verification failed", verified.error?.message);
    return null;
  }

  const scoped = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
  return { supabase: scoped, userId: session.user.id };
}
