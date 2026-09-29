// Server-only: sends email through Microsoft Graph and escapes text for email HTML.
// Shared by every Outlook approval feature (leave, and later onboarding).
// The ".server" in the file name keeps it (and the secrets it reads) out of the browser.

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Escapes text before it goes into email HTML. */
export function esc(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Signs in to Microsoft as the HRMS app and returns an access token. */
export async function graphToken() {
  const tenant = required("MS_TENANT_ID");
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("MS_CLIENT_ID"),
      client_secret: required("MS_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token)
    throw new Error(
      `Microsoft Graph token request failed: ${body.error_description || response.statusText}`,
    );
  return body.access_token as string;
}

/** Sends an HTML email from the configured sender mailbox. */
export async function sendMail(to: string, subject: string, html: string) {
  const sender = required("MS_SENDER_EMAIL");
  const token = await graphToken();
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Microsoft Graph sendMail failed: ${response.status} ${await response.text()}`);
}