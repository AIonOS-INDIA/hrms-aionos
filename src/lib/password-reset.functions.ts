import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
});

/** Only this app's own origins may receive a reset link. */
function allowedOrigin(): string {
  const fallback = "https://hr-aionos.lovable.app";
  let host = "";
  try {
    const req = getRequest();
    host = req?.headers.get("host") ?? "";
  } catch {
    host = "";
  }
  if (!host) return fallback;
  const bare = host.toLowerCase().split(":")[0] ?? "";
  const isLocal = bare === "localhost" || bare === "127.0.0.1";
  const isLovable = bare === "hr-aionos.lovable.app" || bare.endsWith(".lovable.app");
  if (isLocal) return `http://${host}`;
  if (isLovable) return `https://${host}`;
  return fallback;
}

/**
 * Sends a password reset link only when the email belongs to someone
 * on record. Unknown addresses receive nothing.
 */
export const sendPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: employee, error } = await supabaseAdmin
      .from("employees")
      .select("id, user_id, full_name, status, email")
      .ilike("email", email)
      .maybeSingle();
    if (error) {
      console.error("sendPasswordReset lookup failed", error);
      throw new Error("Could not send reset link. Please try again later.");
    }

    if (!employee) return { sent: false as const };
    if (employee.status === "offboarded") return { sent: false as const };

    // Abuse gate: at most one link every 2 minutes and 5 per hour per address.
    const db = supabaseAdmin as unknown as {
      from: (t: string) => any;
    };
    const now = Date.now();
    const { data: attempt } = await db
      .from("password_reset_attempts")
      .select("email,last_sent_at,sent_count")
      .eq("email", email)
      .maybeSingle();
    if (attempt) {
      const last = new Date(attempt.last_sent_at as string).getTime();
      const withinHour = now - last < 60 * 60 * 1000;
      if (now - last < 2 * 60 * 1000) return { sent: false as const };
      if (withinHour && Number(attempt.sent_count ?? 0) >= 5) return { sent: false as const };
      await db
        .from("password_reset_attempts")
        .update({
          last_sent_at: new Date(now).toISOString(),
          sent_count: withinHour ? Number(attempt.sent_count ?? 0) + 1 : 1,
          updated_at: new Date(now).toISOString(),
        })
        .eq("email", email);
    } else {
      await db
        .from("password_reset_attempts")
        .insert({ email, last_sent_at: new Date(now).toISOString(), sent_count: 1 });
    }


    // First-time users have no login yet: create one silently so the
    // reset link they receive lets them set their own password.
    if (!employee.user_id) {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: employee.email,
        password: crypto.randomUUID() + "Aa1!",
        email_confirm: true,
        user_metadata: { full_name: employee.full_name },
      });
      if (createError || !created?.user) {
        console.error("sendPasswordReset create login failed", createError);
        throw new Error("Could not send reset link. Please try again later.");
      }
      const { error: linkError } = await supabaseAdmin
        .from("employees")
        .update({ user_id: created.user.id })
        .eq("id", employee.id);
      if (linkError) console.error("sendPasswordReset link failed", linkError);
    }

    const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: `${allowedOrigin()}/reset-password`,
    });
    if (resetError) {
      console.error("sendPasswordReset email failed", resetError);
      throw new Error("Could not send reset link. Please try again later.");
    }

    return { sent: true as const };
  });

