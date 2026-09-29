import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnboardingCardRequest } from "@/lib/onboarding-card.server";

// POST /api/public/onboarding/submit
// Called by the Onboarding requests page with the user's login token.
//   { ...form fields }  -> validates, saves the request, emails the Outlook card
//   { resendId }        -> re-sends the card for a pending request

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The fields the page can send. Listed explicitly so they can be read as body.field_name. */
type Field =
  | "resendId"
  | "joining_type"
  | "full_name"
  | "personal_email"
  | "phone"
  | "address"
  | "department"
  | "designation"
  | "college"
  | "start_date"
  | "end_date"
  | "approver_email";
type SubmitBody = Partial<Record<Field, unknown>>;

/** Escape % and _ so ilike matches the email exactly (case-insensitive), not as a pattern. */
const exactIlike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

function validate(input: SubmitBody) {
  const types = ["intern", "full_time", "contract"];
  if (!types.includes(String(input.joining_type))) throw new Error("Invalid joining type");
  if (
    typeof input.full_name !== "string" ||
    input.full_name.trim().length < 2 ||
    input.full_name.trim().length > 120
  )
    throw new Error("Full name must be 2 to 120 characters");
  if (typeof input.personal_email !== "string" || !EMAIL_RE.test(input.personal_email.trim()))
    throw new Error("A valid personal email is required");
  if (typeof input.phone === "string" && input.phone.length > 20)
    throw new Error("Phone number is too long");
  if (typeof input.address !== "string" || !input.address.trim())
    throw new Error("Address is required");
  if (input.address.length > 500) throw new Error("Address must be under 500 characters");
  if (typeof input.start_date !== "string" || !DATE_RE.test(input.start_date))
    throw new Error("A valid start date is required");
  if (input.end_date && (typeof input.end_date !== "string" || !DATE_RE.test(input.end_date)))
    throw new Error("A valid end date is required");
  if (input.joining_type !== "full_time" && !input.end_date)
    throw new Error("An end date is required for interns and contractors");
  if (input.end_date && String(input.end_date) < String(input.start_date))
    throw new Error("End date must be on or after start date");
  if (typeof input.approver_email !== "string" || !EMAIL_RE.test(input.approver_email.trim()))
    throw new Error("A valid approving manager email is required");
}

/** The public address Outlook will call when the manager clicks Approve or Deny. */
function decisionUrl(request: Request) {
  const base = process.env["APP_PUBLIC_URL"] || new URL(request.url).origin;
  return `${base.replace(/\/$/, "")}/api/public/onboarding/decision`;
}

/** Sends the card and records the result, so a failed email shows in the portal (never silent). */
async function sendAndRecord(
  admin: SupabaseClient,
  row: OnboardingCardRequest,
  url: string,
) {
  const { cardHtml, sendMail } = await import("@/lib/onboarding-card.server");
  try {
    await sendMail(row.approver_email, `Onboarding approval: ${row.full_name}`, cardHtml(row, url));
    await admin
      .from("onboarding_requests")
      .update({ email_sent_at: new Date().toISOString(), email_error: null })
      .eq("id", row.id);
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[onboarding] approval email for ${row.id} failed:`, message);
    await admin.from("onboarding_requests").update({ email_error: message }).eq("id", row.id);
    return { ok: false as const, emailError: message };
  }
}

export const Route = createFileRoute("/api/public/onboarding/submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // The generated database types don't include onboarding_requests yet,
          // so use an untyped view of the same admin client.
          const admin = supabaseAdmin as unknown as SupabaseClient;

          // 1. Who is calling? (the page sends the user's login token)
          const auth = request.headers.get("Authorization");
          if (!auth?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
          const { data: userData, error: userError } = await admin.auth.getUser(auth.slice(7));
          if (userError || !userData.user) return json({ error: "Authentication required" }, 401);

          const { data: employee } = await admin
            .from("employees")
            .select("id, company_id, full_name, email, status")
            .eq("user_id", userData.user.id)
            .maybeSingle();
          if (!employee || employee.status === "offboarded")
            return json({ error: "Your active employee record was not found" }, 400);

          let body: SubmitBody;
          try {
            body = await request.json();
          } catch {
            return json({ error: "Invalid request" }, 400);
          }
          const url = decisionUrl(request);

          // 2. Resend the card for an existing pending request
          if (body.resendId) {
            const { data: existing, error } = await admin
              .from("onboarding_requests")
              .select("*")
              .eq("id", body.resendId)
              .maybeSingle();
            if (error || !existing) return json({ error: "Request not found" }, 404);
            const { data: roles } = await admin
              .from("user_roles")
              .select("role, company_id")
              .eq("user_id", userData.user.id)
              .in("role", ["master_hr", "company_hr"]);
            const allowed =
              existing.requested_by === employee.id ||
              (roles ?? []).some(
                (r: { role: string; company_id: string | null }) =>
                  r.role === "master_hr" ||
                  (r.role === "company_hr" && r.company_id === existing.company_id),
              );
            if (!allowed) return json({ error: "You cannot resend this request" }, 403);
            if (existing.status !== "pending")
              return json({ error: "Only pending requests can be resent" }, 400);
            return json(await sendAndRecord(admin, existing as OnboardingCardRequest, url));
          }

          // 3. New request: validate, find the approver, save, send the card
          validate(body);
          const approverEmail = String(body.approver_email).trim().toLowerCase();
          const { data: approver, error: approverError } = await admin
            .from("employees")
            .select("id, full_name, email, status, company_id")
            .ilike("email", exactIlike(approverEmail))
            .maybeSingle();
          if (approverError) {
            console.error("[onboarding] approver lookup failed:", approverError.message);
            return json({ error: "Could not look up the approving manager. Try again." }, 500);
          }
          if (!approver)
            return json({ error: `No employee found with the email ${approverEmail}` }, 400);
          if (approver.status !== "active")
            return json({ error: "Approving manager must be an active employee" }, 400);
          if (approver.id === employee.id)
            return json({ error: "You cannot approve your own request" }, 400);

          const { data: created, error: insertError } = await admin
            .from("onboarding_requests")
            .insert({
              company_id: employee.company_id,
              joining_type: body.joining_type,
              full_name: String(body.full_name).trim(),
              personal_email: String(body.personal_email).trim().toLowerCase(),
              phone: body.phone || null,
              address: String(body.address).trim(),
              department: body.department || null,
              designation: body.designation || null,
              college: body.joining_type === "intern" ? body.college || null : null,
              start_date: body.start_date,
              end_date: body.joining_type === "full_time" ? null : body.end_date || null,
              requested_by: employee.id,
              requested_by_name: employee.full_name,
              approver_id: approver.id,
              approver_name: approver.full_name,
              approver_email: String(approver.email).toLowerCase(),
            })
            .select("*")
            .single();
          if (insertError || !created)
            return json({ error: insertError?.message ?? "Could not save request" }, 400);

          const result = await sendAndRecord(admin, created as OnboardingCardRequest, url);
          return json({ ...result, request: created });
        } catch (error) {
          console.error("[onboarding] submit failed:", error);
          return json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
      },
    },
  },
});