// Server-only: builds the Outlook approval card and sends email through Microsoft Graph.
// The ".server" in the file name keeps it (and the secrets it reads) out of the browser bundle.

export type OnboardingCardRequest = {
  id: string;
  joining_type: string;
  full_name: string;
  personal_email: string;
  phone: string | null;
  address: string;
  department: string | null;
  designation: string | null;
  college: string | null;
  start_date: string;
  end_date: string | null;
  approver_email: string;
  status: string;
  decision_note: string | null;
  decided_at: string | null;
};

function required(name: string, optional = false) {
  const value = process.env[name];
  if (!value && !optional) throw new Error(`Missing required environment variable: ${name}`);
  return value ?? "";
}

/** Escapes text before it goes into email HTML. */
export function esc(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function typeLabel(value: string) {
  return value === "full_time" ? "Full-time" : value.charAt(0).toUpperCase() + value.slice(1);
}

function duration(start: string, end: string | null) {
  if (!end) return "Not applicable";
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  return `${days} day${days === 1 ? "" : "s"}`;
}

function facts(request: OnboardingCardRequest) {
  return [
    ["Joining type", typeLabel(request.joining_type)],
    ["Full name", request.full_name],
    ["Personal email", request.personal_email],
    ["Phone", request.phone || "Not provided"],
    ["Address", request.address],
    ["Department", request.department || "Not provided"],
    ["Designation", request.designation || "Not provided"],
    ["College", request.college || "Not applicable"],
    ["Start date", request.start_date],
    ["End date", request.end_date || "Not applicable"],
    ["Duration", duration(request.start_date, request.end_date)],
  ].map(([title, value]) => ({ title, value }));
}

export function outcomeCard(request: OnboardingCardRequest) {
  const rejected = request.status === "rejected";
  const approved = request.status === "approved";
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.0",
    originator: required("AM_ORIGINATOR_ID"),
    body: [
      {
        type: "TextBlock",
        text: approved
          ? "Onboarding request approved"
          : rejected
            ? "Onboarding request denied"
            : "Onboarding request",
        weight: "Bolder",
        size: "Medium",
      },
      { type: "FactSet", facts: facts(request) },
      ...(request.decision_note
        ? [
            {
              type: "TextBlock",
              text: `Reason: ${request.decision_note}`,
              wrap: true,
              color: "Attention",
            },
          ]
        : []),
      ...(request.decided_at
        ? [
            {
              type: "TextBlock",
              text: `Decided at ${new Date(request.decided_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
              isSubtle: true,
              spacing: "Small",
            },
          ]
        : []),
    ],
  };
}

export function actionCard(request: OnboardingCardRequest, decisionUrl: string) {
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.0",
    originator: required("AM_ORIGINATOR_ID"),
    hideOriginalBody: true,
    expectedActors: [request.approver_email],
    body: [
      { type: "TextBlock", text: "Onboarding request", weight: "Bolder", size: "Medium" },
      { type: "FactSet", facts: facts(request) },
    ],
    actions: [
      {
        type: "Action.Http",
        title: "Approve",
        method: "POST",
        url: decisionUrl,
        body: JSON.stringify({ requestId: request.id, action: "approve" }),
        headers: [{ name: "Content-Type", value: "application/json" }],
      },
      {
        type: "Action.ShowCard",
        title: "Deny",
        card: {
          type: "AdaptiveCard",
          version: "1.0",
          body: [
            {
              type: "Input.Text",
              id: "reason",
              placeholder: "Reason for denying (required)",
              isMultiline: true,
            },
          ],
          actions: [
            {
              type: "Action.Http",
              title: "Deny request",
              method: "POST",
              url: decisionUrl,
              body: JSON.stringify({
                requestId: request.id,
                action: "deny",
                reason: "{{reason.value}}",
              }),
              headers: [{ name: "Content-Type", value: "application/json" }],
            },
          ],
        },
      },
    ],
  };
}

/** The approval email: the card goes in <head>, and a plain fallback in <body>. */
export function cardHtml(request: OnboardingCardRequest, decisionUrl: string) {
  // Escape "<" so user-entered text can never close the <script> tag.
  const card = JSON.stringify(actionCard(request, decisionUrl)).replaceAll("<", "\\u003c");
  const portal = required("APP_PUBLIC_URL", true);
  const link = portal
    ? `<p><a href="${esc(portal)}/onboarding-requests">Open in HR portal</a></p>`
    : "";
  return `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><script type="application/adaptivecard+json">${card}</script></head><body><p>Please review the onboarding request for <strong>${esc(request.full_name)}</strong>.</p><p>Start date: ${esc(request.start_date)}</p><p>Open this email in Outlook to approve or deny it.</p>${link}</body></html>`;
}

export async function graphToken() {
  const tenant = required("MS_TENANT_ID");
  const clientId = required("MS_CLIENT_ID");
  const clientSecret = required("MS_CLIENT_SECRET");
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
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