// Server-only: builds the Outlook Approve / Deny card for a leave request.
// Email sending and text escaping are reused from outlook-mail.server.ts.
import { esc } from "@/lib/outlook-mail.server";

export type LeaveCardData = {
  id: string;
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number | string;
  reason: string | null;
  status: string;
  manager_email: string;
};

function originator() {
  const value = process.env["AM_ORIGINATOR_ID"];
  if (!value) throw new Error("Missing required environment variable: AM_ORIGINATOR_ID");
  return value;
}

function daysLabel(days: number | string) {
  const n = Number(days);
  return `${n} day${n === 1 ? "" : "s"}`;
}

function facts(leave: LeaveCardData) {
  return [
    { title: "Employee", value: leave.employee_name },
    { title: "Leave type", value: leave.leave_type },
    { title: "From", value: leave.start_date },
    { title: "To", value: leave.end_date },
    { title: "Duration", value: daysLabel(leave.days) },
    { title: "Reason", value: leave.reason || "Not given" },
  ];
}

/** The card the manager sees in Outlook, with Approve and Deny. */
export function leaveActionCard(leave: LeaveCardData, decisionUrl: string) {
  const headers = [{ name: "Content-Type", value: "application/json" }];
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.0",
    originator: originator(),
    hideOriginalBody: true,
    expectedActors: [leave.manager_email],
    body: [
      { type: "TextBlock", text: "Leave request", weight: "Bolder", size: "Medium" },
      {
        type: "TextBlock",
        text: `${leave.employee_name} has applied for leave.`,
        wrap: true,
      },
      { type: "FactSet", facts: facts(leave) },
    ],
    actions: [
      {
        type: "Action.Http",
        title: "Approve",
        method: "POST",
        url: decisionUrl,
        headers,
        body: JSON.stringify({ requestId: leave.id, action: "approve" }),
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
              headers,
              body: JSON.stringify({ requestId: leave.id, action: "deny", reason: "{{reason.value}}" }),
            },
          ],
        },
      },
    ],
  };
}

/** The card that replaces the buttons once a decision is made. */
export function leaveOutcomeCard(leave: LeaveCardData, denyReason?: string) {
  const heading =
    leave.status === "approved"
      ? "Leave approved"
      : leave.status === "rejected"
        ? "Leave denied"
        : leave.status === "cancelled"
          ? "Leave cancelled by the employee"
          : "Leave request";
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.0",
    originator: originator(),
    body: [
      { type: "TextBlock", text: heading, weight: "Bolder", size: "Medium" },
      { type: "FactSet", facts: facts(leave) },
      ...(denyReason
        ? [{ type: "TextBlock", text: `Reason: ${denyReason}`, wrap: true, color: "Attention" }]
        : []),
    ],
  };
}

/** The approval email: card in <head>, plain fallback in <body>. */
export function leaveCardHtml(leave: LeaveCardData, decisionUrl: string) {
  const card = JSON.stringify(leaveActionCard(leave, decisionUrl)).replaceAll("<", "\\u003c");
  const portal = process.env["APP_PUBLIC_URL"] ?? "";
  const link = portal ? `<p><a href="${esc(portal)}/leave">Open in HR portal</a></p>` : "";
  return `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><script type="application/adaptivecard+json">${card}</script></head><body><p><strong>${esc(leave.employee_name)}</strong> has applied for ${esc(leave.leave_type)} from ${esc(leave.start_date)} to ${esc(leave.end_date)} (${esc(daysLabel(leave.days))}).</p><p>Open this email in Outlook to approve or deny it.</p>${link}</body></html>`;
}