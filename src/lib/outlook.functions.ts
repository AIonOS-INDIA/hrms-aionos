import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "microsoft_outlook";

export const OUTLOOK_SCOPES = ["openid", "profile", "email", "offline_access", "Mail.Send"];

export const startOutlookConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientAPIKey = process.env["MICROSOFT_OUTLOOK_APP_USER_CONNECTOR_CLIENT_API_KEY"];
    if (!clientAPIKey) throw new Error("Outlook is not switched on for this app yet.");
    const request = getRequest();
    if (!request) throw new Error("Sign-in must start from the app.");
    const returnUrl = new URL("/oauth/outlook/return", new URL(request.url).origin).toString();
    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CONNECTOR_ID,
      appUserId: (context as any).userId,
      clientAPIKey,
      returnUrl,
      credentialsConfiguration: { scopes: OUTLOOK_SCOPES, prompt: "select_account" },
    });
    return { authorizationUrl };
  });

export const completeOutlookConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ code: z.string().min(1) }).parse(data))
  .handler(async ({ context, data }) => {
    const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
    const { encryptConnectionKey } = await import("@/lib/connection-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await exchangeAppUserOAuthCode(GATEWAY_BASE_URL, data.code);
    if (result.connectorId !== CONNECTOR_ID) throw new Error("That sign-in was for a different service.");
    const { error } = await supabaseAdmin.from("app_user_connections").upsert(
      {
        user_id: (context as any).userId,
        connector_id: CONNECTOR_ID,
        connection_key_ciphertext: encryptConnectionKey(result.connectionAPIKey),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,connector_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
