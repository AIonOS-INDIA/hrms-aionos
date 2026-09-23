import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "microsoft_teams";
/** Teams "Notes to self" chat — the employee messages themselves. */
const SELF_CHAT = "48:notes";

export const TEAMS_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "Chat.Read",
  "ChatMessage.Send",
];

async function myEmployee(context: any) {
  const { data, error } = await context.supabase
    .from("employees")
    .select("id, full_name, email")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No employee record is linked to this login.");
  return data as { id: string; full_name: string; email: string };
}

async function storedKey(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptConnectionKey } = await import("@/lib/connection-crypto.server");
  const { data } = await supabaseAdmin
    .from("app_user_connections")
    .select("connection_key_ciphertext")
    .eq("user_id", userId)
    .eq("connector_id", CONNECTOR_ID)
    .maybeSingle();
  return data ? decryptConnectionKey((data as any).connection_key_ciphertext) : null;
}

export const startTeamsConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientAPIKey = process.env["MICROSOFT_TEAMS_APP_USER_CONNECTOR_CLIENT_API_KEY"];
    if (!clientAPIKey) {
      throw new Error("Microsoft Teams is not switched on for this app yet.");
    }
    await myEmployee(context);

    const request = getRequest();
    if (!request) throw new Error("Sign-in must start from the app.");
    const url = new URL(request.url);
    const sandboxHost =
      url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const returnUrl = new URL(
      "/oauth/teams/return",
      sandboxHost ? `https://${sandboxHost}` : url.origin,
    ).toString();

    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    const existing = await storedKey((context as any).userId);

    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CONNECTOR_ID,
      appUserId: (context as any).userId,
      clientAPIKey,
      returnUrl,
      ...(existing ? { connectionAPIKey: existing } : {}),
      credentialsConfiguration: {
        scopes: TEAMS_SCOPES,
        prompt: "select_account",
      },
    });
    return { authorizationUrl };
  });

export const completeTeamsConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const emp = await myEmployee(context);
    const userId = (context as any).userId as string;

    const { exchangeAppUserOAuthCode, callAsAppUser } = await import(
      "@/integrations/lovable/appUserConnector"
    );
    const { encryptConnectionKey } = await import("@/lib/connection-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(
      GATEWAY_BASE_URL,
      data.code,
    );
    if (connectorId !== CONNECTOR_ID) throw new Error("That sign-in was for a different service.");

    const saved = await supabaseAdmin.from("app_user_connections").upsert(
      {
        user_id: userId,
        connector_id: CONNECTOR_ID,
        connection_key_ciphertext: encryptConnectionKey(connectionAPIKey),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,connector_id" },
    );
    if (saved.error) throw new Error(saved.error.message);

    let handle = emp.email;
    const who = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CONNECTOR_ID,
      connectionAPIKey,
      path: "/me",
      requiredScopes: TEAMS_SCOPES,
    });
    if (who.ok) {
      const me = (await who.json()) as { id?: string; userPrincipalName?: string };
      handle = me.id ?? me.userPrincipalName ?? emp.email;
    }

    const link = await supabaseAdmin.from("employee_channel_links").upsert(
      {
        employee_id: emp.id,
        channel: CONNECTOR_ID,
        handle,
        status: "connected",
        verification_code: null,
        code_expires_at: null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,channel" },
    );
    if (link.error) throw new Error(link.error.message);

    return { ok: true };
  });

/** Reads new messages the employee sent themselves in Teams and answers them there. */
export const syncTeamsChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const emp = await myEmployee(context);
    const userId = (context as any).userId as string;
    const connectionAPIKey = await storedKey(userId);
    if (!connectionAPIKey) throw new Error("Connect Microsoft Teams first.");

    const { callAsAppUser, appUserReconnectRequired } = await import(
      "@/integrations/lovable/appUserConnector"
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runAssistantTurn } = await import("@/lib/assistant.functions");

    const { data: link } = await supabaseAdmin
      .from("employee_channel_links")
      .select("*")
      .eq("employee_id", emp.id)
      .eq("channel", CONNECTOR_ID)
      .maybeSingle();
    if (!link) throw new Error("Connect Microsoft Teams first.");

    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CONNECTOR_ID,
      connectionAPIKey,
      path: `/chats/${SELF_CHAT}/messages?$top=10`,
      requiredScopes: TEAMS_SCOPES,
    });
    if (await appUserReconnectRequired(res)) {
      return { answered: 0, reconnectRequired: true };
    }
    if (!res.ok) throw new Error("Could not read your Teams chat right now.");

    const payload = (await res.json()) as { value?: any[] };
    const since = (link as any).last_message_at
      ? new Date((link as any).last_message_at).getTime()
      : 0;

    const incoming = (payload.value ?? [])
      .filter((m) => (m?.body?.content ?? "").trim() && m?.from?.user)
      .filter((m) => new Date(m.createdDateTime).getTime() > since)
      .sort(
        (a, b) =>
          new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime(),
      )
      .slice(-5);

    if (!incoming.length) return { answered: 0 };

    const { data: history } = await supabaseAdmin
      .from("channel_messages")
      .select("role, content")
      .eq("link_id", (link as any).id)
      .order("created_at", { ascending: false })
      .limit(12);
    const turns = ((history ?? []) as { role: "user" | "assistant"; content: string }[])
      .slice()
      .reverse();

    let answered = 0;
    for (const message of incoming) {
      const text = String(message.body.content)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;

      turns.push({ role: "user", content: text });
      const { reply } = await runAssistantTurn(
        { supabase: (context as any).supabase, userId },
        turns,
        "teams",
      );
      turns.push({ role: "assistant", content: reply });

      await callAsAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectorId: CONNECTOR_ID,
        connectionAPIKey,
        path: `/chats/${SELF_CHAT}/messages`,
        requiredScopes: TEAMS_SCOPES,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: { content: reply } }),
        },
      });

      await supabaseAdmin.from("channel_messages").insert([
        {
          link_id: (link as any).id,
          role: "user",
          content: text,
          external_id: String(message.id ?? ""),
        },
        { link_id: (link as any).id, role: "assistant", content: reply },
      ]);
      answered += 1;
    }

    await supabaseAdmin
      .from("employee_channel_links")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", (link as any).id);

    return { answered };
  });
