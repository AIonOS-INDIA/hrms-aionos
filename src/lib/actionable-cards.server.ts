import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callAsAppUser } from "@/integrations/lovable/appUserConnector";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const TEAMS_CONNECTOR = "microsoft_teams";
const TEAMS_SELF_CHAT = "48:notes";
const ACTION_TTL_SECONDS = 60 * 60 * 24 * 7;
const db = supabaseAdmin as any;
let cachedGraphToken: { accessToken: string; expiresAt: number } | undefined;
let graphTokenRequest: Promise<string> | undefined;

type ApprovalKind = "leave" | "timesheet" | "expense";
type Decision = "approved" | "rejected";

type ApprovalCard = {
  kind: ApprovalKind;
  id: string;
  employeeName: string;
  title: string;
  detail: string;
};

type TokenPayload = {
  kind: ApprovalKind;
  id: string;
  userId: string;
  decision: Decision;
  exp: number;
};

function signingSecret(): string {
  const value = process.env["APPROVAL_CARD_SIGNING_SECRET"];
  if (!value || value.length < 32 || value === "...") {
    throw new Error("APPROVAL_CARD_SIGNING_SECRET must be a random value of at least 32 characters.");
  }
  return value;
}

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function signToken(payload: TokenPayload): string {
  const body = encode(JSON.stringify(payload));
  const signature = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyApprovalActionToken(token: string): TokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (!payload.userId || !payload.id || !payload.kind || !payload.decision || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function actionUrl(baseUrl: string, payload: TokenPayload): string {
  return `${baseUrl.replace(/\/$/, "")}/api/actionable/approval?token=${encodeURIComponent(signToken(payload))}`;
}

function adaptiveCard(card: ApprovalCard, approveUrl: string, rejectUrl: string): Record<string, unknown> {
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.2",
    body: [
      { type: "TextBlock", text: "AIONOS HR approval", weight: "Bolder", size: "Medium" },
      { type: "TextBlock", text: card.title, weight: "Bolder", wrap: true },
      { type: "TextBlock", text: card.detail, isSubtle: true, wrap: true, spacing: "Small" },
    ],
    actions: [
      { type: "Action.OpenUrl", title: "Approve", url: approveUrl },
      { type: "Action.OpenUrl", title: "Reject", url: rejectUrl },
    ],
  };
}

function outlookAdaptiveCard(card: ApprovalCard, approveUrl: string, rejectUrl: string): Record<string, unknown> {
  const rejectionInput = card.kind === "leave"
    ? [{ type: "Input.Text", id: "leaveRejectionReason", placeholder: "Reason for rejection (required)", isMultiline: true, maxLength: 1000 }]
    : [];
  const rejectionBody = card.kind === "leave"
    ? JSON.stringify({ reason: "{{leaveRejectionReason.value}}" })
    : "{}";
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.2",
    body: [
      { type: "TextBlock", text: "AIONOS HR approval", weight: "Bolder", size: "Medium" },
      { type: "TextBlock", text: card.employeeName, weight: "Bolder", wrap: true },
      { type: "TextBlock", text: card.title, wrap: true },
      { type: "TextBlock", text: card.detail, isSubtle: true, wrap: true, spacing: "Small" },
      ...rejectionInput,
    ],
    actions: [
      { type: "Action.Http", title: "Approve", method: "POST", url: approveUrl, headers: [{ name: "Content-Type", value: "application/json" }], body: "{}" },
      { type: "Action.Http", title: "Reject", method: "POST", url: rejectUrl, headers: [{ name: "Content-Type", value: "application/json" }], body: rejectionBody },
    ],
  };
}

async function connectionKey(userId: string, connectorId: string): Promise<string | null> {
  const { decryptConnectionKey } = await import("@/lib/connection-crypto.server");
  const { data } = await db
    .from("app_user_connections")
    .select("connection_key_ciphertext")
    .eq("user_id", userId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  return data ? decryptConnectionKey((data as any).connection_key_ciphertext) : null;
}

async function sendTeams(userId: string, card: ApprovalCard, baseUrl: string): Promise<void> {
  const key = await connectionKey(userId, TEAMS_CONNECTOR);
  if (!key) return;
  const approveUrl = actionUrl(baseUrl, { kind: card.kind, id: card.id, userId, decision: "approved", exp: Math.floor(Date.now() / 1000) + ACTION_TTL_SECONDS });
  const rejectUrl = actionUrl(baseUrl, { kind: card.kind, id: card.id, userId, decision: "rejected", exp: Math.floor(Date.now() / 1000) + ACTION_TTL_SECONDS });
  const response = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectorId: TEAMS_CONNECTOR,
    connectionAPIKey: key,
    path: `/chats/${TEAMS_SELF_CHAT}/messages`,
    requiredScopes: ["Chat.Read", "ChatMessage.Send"],
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: { contentType: "html", content: `<strong>AIONOS HR approval</strong><br>${html(card.title)}<br>${html(card.detail)}` },
        attachments: [{
          id: "approval-card",
          contentType: "application/vnd.microsoft.card.adaptive",
          content: JSON.stringify(adaptiveCard(card, approveUrl, rejectUrl)),
        }],
      }),
    },
  });
  if (!response.ok) throw new Error(`Teams card delivery failed (${response.status})`);
}

async function microsoftGraphAccessToken(): Promise<string> {
  const tenantId = process.env["MICROSOFT_TENANT_ID"];
  const clientId = process.env["MICROSOFT_CLIENT_ID"];
  const clientSecret = process.env["MICROSOFT_CLIENT_SECRET"];
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft Graph app-only credentials are not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (cachedGraphToken && cachedGraphToken.expiresAt > now + 60) return cachedGraphToken.accessToken;
  if (graphTokenRequest) return graphTokenRequest;

  const request = (async () => {
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });
    if (!response.ok) throw new Error(`Microsoft Graph token request failed (${response.status}).`);
    const token = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!token.access_token) throw new Error("Microsoft Graph token response did not include an access token.");
    cachedGraphToken = {
      accessToken: token.access_token,
      expiresAt: now + (Number(token.expires_in) || 3600),
    };
    return token.access_token;
  })();

  graphTokenRequest = request;
  try {
    return await request;
  } finally {
    if (graphTokenRequest === request) graphTokenRequest = undefined;
  }
}

async function sendGraphMail(recipient: string, subject: string, content: string): Promise<void> {
  const sender = process.env["OUTLOOK_SENDER_EMAIL"];
  if (!sender) throw new Error("OUTLOOK_SENDER_EMAIL is not configured.");
  const accessToken = await microsoftGraphAccessToken();
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content },
        toRecipients: [{ emailAddress: { address: recipient } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (result?.error?.code === "ErrorInvalidUser") {
      throw new Error("OUTLOOK_SENDER_EMAIL must be an Exchange Online mailbox in the configured Microsoft tenant.");
    }
    throw new Error(`Outlook email delivery failed (${response.status}).`);
  }
}

export async function sendStandardOutlookApprovalTestEmail(
  recipient: string,
  requesterName: string,
  portalUrl: string,
): Promise<void> {
  await sendGraphMail(
    recipient,
    "[TEST] AIONOS leave approval email",
    `<p>Hello,</p><p>This is a test of standard Outlook approval email delivery for ${html(requesterName)}.</p><p>No leave request was created or changed. When a request is submitted, it will appear in your approvals after you sign in.</p><p><a href="${html(portalUrl)}">Open the AIONOS HR leave portal</a></p>`,
  );
}

async function sendOutlook(userId: string, recipient: string, card: ApprovalCard, baseUrl: string): Promise<void> {
  const sender = process.env["OUTLOOK_SENDER_EMAIL"];
  const originator = process.env["OUTLOOK_ACTIONABLE_MESSAGE_ORIGINATOR"];
  if (!sender) throw new Error("OUTLOOK_SENDER_EMAIL is not configured.");
  const signingValue = process.env["APPROVAL_CARD_SIGNING_SECRET"];
  const actionableReady = Boolean(
    originator && originator !== "..." && signingValue && signingValue.length >= 32 && signingValue !== "...",
  );
  if (!actionableReady) {
    const portalPath = card.kind === "leave" ? "/leave" : card.kind === "timesheet" ? "/timesheets" : "/expenses";
    const portalUrl = `${baseUrl.replace(/\/$/, "")}${portalPath}`;
    await sendGraphMail(
      recipient,
      `Approval required: ${card.title}`,
      `<p>Hello ${html(card.employeeName)},</p><p>${html(card.title)}</p><p>${html(card.detail)}</p><p>Please sign in to AIONOS HR to review and decide this request.</p><p><a href="${html(portalUrl)}">Open approval in AIONOS HR</a></p>`,
    );
    return;
  }
  const approveUrl = actionUrl(baseUrl, { kind: card.kind, id: card.id, userId, decision: "approved", exp: Math.floor(Date.now() / 1000) + ACTION_TTL_SECONDS });
  const rejectUrl = actionUrl(baseUrl, { kind: card.kind, id: card.id, userId, decision: "rejected", exp: Math.floor(Date.now() / 1000) + ACTION_TTL_SECONDS });
  const cardJson = JSON.stringify({
    ...outlookAdaptiveCard(card, approveUrl, rejectUrl),
    originator,
  });
  await sendGraphMail(
    recipient,
    `AIONOS approval: ${card.title}`,
    `<p>${html(card.employeeName)}</p><p>${html(card.title)}</p><p>${html(card.detail)}</p><script type="application/adaptivecard+json">${cardJson.replace(/</g, "\\u003c")}</script>`,
  );
}

export async function sendLeaveDecisionEmail(approvalId: string, decision: Decision, decisionNote = ""): Promise<void> {
  const { data: leave, error } = await db
    .from("leave_requests")
    .select("employee_id, start_date, end_date, days")
    .eq("id", approvalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!leave) throw new Error("Leave request not found for decision email.");
  const { data: employee, error: employeeError } = await db
    .from("employees")
    .select("full_name, email")
    .eq("id", leave.employee_id)
    .maybeSingle();
  if (employeeError) throw new Error(employeeError.message);
  if (!employee?.email) return;

  const result = decision === "approved" ? "approved" : "rejected";
  const note = decisionNote.trim();
  const portalUrl = process.env["APP_PUBLIC_URL"];
  const portalLink = portalUrl
    ? `<p><a href="${html(`${portalUrl.replace(/\/$/, "")}/leave`)}">View your request in the AIONOS HR portal.</a></p>`
    : "<p>View your request in the AIONOS HR portal.</p>";
  await sendGraphMail(
    employee.email,
    `Leave request ${result}`,
    `<p>Hello ${html(employee.full_name ?? "")},</p><p>Your leave request for ${html(String(leave.days))} day(s), ${html(leave.start_date)} to ${html(leave.end_date)}, was ${result}.</p>${note ? `<p>Manager's note: ${html(note)}</p>` : ""}${portalLink}`,
  );
}

async function recipientIds(kind: ApprovalKind, approvalId: string): Promise<Set<string>> {
  const table = kind === "leave" ? "leave_requests" : kind === "timesheet" ? "timesheets" : "expense_claims";
  const { data: item, error } = await db.from(table).select("employee_id, company_id").eq("id", approvalId).maybeSingle();
  if (error || !item) return new Set();
  const { data: employee } = await db.from("employees").select("company_id, manager_id").eq("id", item.employee_id).maybeSingle();
  const { data: roles } = await db.from("user_roles").select("user_id, role, company_id");
  const { data: employees } = await db.from("employees").select("id, user_id");
  const users = new Set<string>();
  const companyId = employee?.company_id ?? (item as any).company_id;
  const managerUserId = employees?.find((row: any) => row.id === employee?.manager_id)?.user_id;
  if (managerUserId) users.add(managerUserId);
  if (kind === "leave") return users;
  for (const role of roles ?? []) {
    const roleApplies = role.role === "master_hr" ||
      (role.role === "company_hr" && role.company_id === companyId) ||
      (kind === "expense" && role.role === "finance_expense" && role.company_id === companyId) ||
      (kind === "timesheet" && role.role === "finance_payroll" && role.company_id === companyId);
    if (roleApplies) users.add(role.user_id);
  }
  return users;
}

export async function dispatchApprovalCards(kind: ApprovalKind, approvalId: string, baseUrl: string): Promise<{ sent: number }> {
  const recipients = await recipientIds(kind, approvalId);
  if (!recipients.size) return { sent: 0 };
  const table = kind === "leave" ? "leave_requests" : kind === "timesheet" ? "timesheets" : "expense_claims";
  const { data: item } = await db.from(table).select("*").eq("id", approvalId).maybeSingle();
  if (!item) return { sent: 0 };
  const { data: employee } = await db.from("employees").select("full_name, email").eq("id", item.employee_id).maybeSingle();
  const card: ApprovalCard = kind === "leave"
    ? { kind, id: approvalId, employeeName: employee?.full_name ?? "Team member", title: `Leave request · ${item.days} day(s)`, detail: `${item.start_date} to ${item.end_date}${item.reason ? ` · ${item.reason}` : ""}` }
    : kind === "timesheet"
      ? { kind, id: approvalId, employeeName: employee?.full_name ?? "Team member", title: `Timesheet · ${item.total_hours} hours`, detail: `Week of ${item.week_start}` }
      : { kind, id: approvalId, employeeName: employee?.full_name ?? "Team member", title: `Expense · ${item.title}`, detail: `${item.total_amount ?? 0} · ${item.destination ?? ""}` };
  let sent = 0;
  for (const userId of recipients) {
    const { data: target } = await db.from("employees").select("email").eq("user_id", userId).maybeSingle();
    for (const destination of ["teams", "outlook"] as const) {
      const { data: existing } = await db.from("actionable_card_deliveries").select("id, status").match({ approval_kind: kind, approval_id: approvalId, recipient_user_id: userId, destination }).maybeSingle();
      if (existing?.status === "sent") continue;
      try {
        if (destination === "teams") await sendTeams(userId, card, baseUrl);
        else if (target?.email) await sendOutlook(userId, target.email, card, baseUrl);
        else continue;
        await db.from("actionable_card_deliveries").upsert({ approval_kind: kind, approval_id: approvalId, recipient_user_id: userId, destination, status: "sent", sent_at: new Date().toISOString() }, { onConflict: "approval_kind,approval_id,recipient_user_id,destination" });
        sent += 1;
      } catch (error) {
        await db.from("actionable_card_deliveries").upsert({ approval_kind: kind, approval_id: approvalId, recipient_user_id: userId, destination, status: "failed", error_message: error instanceof Error ? error.message : String(error) }, { onConflict: "approval_kind,approval_id,recipient_user_id,destination" });
      }
    }
  }
  return { sent };
}

export async function applyApprovalDecision(payload: TokenPayload, decisionNote = ""): Promise<string> {
  const kind = payload.kind;
  const table = kind === "leave" ? "leave_requests" : kind === "timesheet" ? "timesheets" : "expense_claims";
  const { data: item } = await db.from(table).select("*").eq("id", payload.id).maybeSingle();
  if (!item) throw new Error("This approval is no longer available.");
  const allowed = await recipientIds(kind, payload.id);
  if (!allowed.has(payload.userId)) throw new Error("You are not allowed to decide this approval.");
  const now = new Date().toISOString();
  if (kind === "leave" && item.status !== "pending") throw new Error("This leave request has already been decided.");
  if (kind === "leave" && payload.decision === "rejected" && !decisionNote.trim()) {
    throw new Error("A reason is required when rejecting a leave request.");
  }
  const update = kind === "leave"
    ? { status: payload.decision, decision_note: decisionNote.trim() || null, decided_at: now }
    : kind === "timesheet"
      ? item.status === "submitted" ? { status: payload.decision, decided_at: now } : { finance_status: payload.decision, finance_decided_at: now }
      : { status: payload.decision, finance_decided_at: now };
  let updateQuery = db.from(table).update(update).eq("id", payload.id);
  if (kind === "leave") updateQuery = updateQuery.eq("status", "pending");
  const { data: updated, error } = await updateQuery.select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new Error("This approval is no longer pending.");
  if (kind === "leave") {
    try {
      await sendLeaveDecisionEmail(payload.id, payload.decision, decisionNote);
    } catch (emailError) {
      console.error("Leave decision email failed", emailError);
    }
  }
  return `${kind} ${payload.decision}`;
}
