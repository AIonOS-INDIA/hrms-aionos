import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Send, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Panel, StatusPill } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useEmployees, useMe } from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/onboarding-requests")({
  head: () => ({ meta: [{ title: "Onboarding requests — AIONOS HR Control Tower" }] }),
  component: OnboardingRequestsPage,
});

type JoiningType = "intern" | "full_time" | "contract";
type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";
type OnboardingRequest = {
  id: string;
  joining_type: JoiningType;
  full_name: string;
  personal_email: string;
  start_date: string;
  end_date: string | null;
  approver_name: string;
  approver_email: string;
  status: RequestStatus;
  decision_note: string | null;
  decided_at: string | null;
  email_error: string | null;
};
type FormState = {
  joining_type: JoiningType;
  full_name: string;
  personal_email: string;
  phone: string;
  address: string;
  department: string;
  designation: string;
  college: string;
  start_date: string;
  end_date: string;
  approver_email: string;
};

const emptyForm: FormState = {
  joining_type: "intern",
  full_name: "",
  personal_email: "",
  phone: "",
  address: "",
  department: "",
  designation: "",
  college: "",
  start_date: "",
  end_date: "",
  approver_email: "",
};
const inputClass =
  "w-full h-9 rounded-md bg-paper ring-1 ring-line px-3 text-[13px] outline-none focus:ring-brand";

function duration(start: string, end: string | null) {
  if (!start || !end) return null;
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  return days > 0 ? `${days} day${days === 1 ? "" : "s"}` : null;
}
function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
        new Date(`${value}T00:00:00`),
      )
    : "—";
}

type ApiResult = { ok?: boolean; emailError?: string; error?: string };

/**
 * Calls the onboarding server route with the user's login token.
 * Throws with the server's own error message (e.g. "You cannot approve your own request").
 */
async function callOnboardingApi(body: unknown): Promise<ApiResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("You need to be logged in.");
  const response = await fetch("/api/public/onboarding/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  let data: ApiResult | null = null;
  try {
    data = (await response.json()) as ApiResult;
  } catch {
    // no JSON body; fall through to the status message
  }
  if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status})`);
  return data ?? {};
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="label-mono">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}

function OnboardingRequestsPage() {
  return (
    <AppShell title="Onboarding requests" subtitle="New joiner approval workflow">
      <OnboardingRequestsBody />
    </AppShell>
  );
}

function OnboardingRequestsBody() {
  const { data: me } = useMe();
  const { data: employees = [] } = useEmployees();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const requests = useQuery({
    queryKey: ["onboarding_requests"],
    queryFn: async () => {
      const { data, error: requestError } = await supabase
        .from("onboarding_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (requestError) throw requestError;
      return (data ?? []) as OnboardingRequest[];
    },
  });
  const managers = useMemo(
    () => employees.filter((employee) => employee.status === "active" && employee.email),
    [employees],
  );
  const isIntern = form.joining_type === "intern";
  const needsEndDate = isIntern || form.joining_type === "contract";
  const setField = (key: keyof FormState, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!needsEndDate) setField("end_date", "");
  }, [needsEndDate]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!me?.employee) return setError("Your employee record is not linked yet.");
    if (needsEndDate && !form.end_date)
      return setError("An end date is required for this joining type.");
    if (form.end_date && form.end_date < form.start_date)
      return setError("End date must be on or after the start date.");
    setSubmitting(true);
    let submitResult: ApiResult;
    try {
      submitResult = await callOnboardingApi({ ...form, end_date: form.end_date || null });
    } catch (err) {
      setSubmitting(false);
      return setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
    setSubmitting(false);
    if (submitResult.emailError) {
      setError(
        `Request saved, but the approval email could not be sent: ${submitResult.emailError}`,
      );
    } else {
      toast.success("Onboarding request sent for approval");
    }
    setForm(emptyForm);
    await queryClient.invalidateQueries({ queryKey: ["onboarding_requests"] });
  }
  async function resend(id: string) {
    setResending(id);
    let resendResult: ApiResult;
    try {
      resendResult = await callOnboardingApi({ resendId: id });
    } catch (err) {
      setResending(null);
      return toast.error(err instanceof Error ? err.message : "Resend failed.");
    }
    setResending(null);
    if (resendResult.emailError) toast.error(`Email still failed: ${resendResult.emailError}`);
    else toast.success("Approval email resent");
    await queryClient.invalidateQueries({ queryKey: ["onboarding_requests"] });
    return;
  }

  return (
    <div className="space-y-5">
      <Panel title="New onboarding request" meta={<UserPlus className="size-4 text-brand" />}>
        <form onSubmit={submit} className="p-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Joining type" required>
              <select
                value={form.joining_type}
                onChange={(e) => setField("joining_type", e.target.value)}
                className={inputClass}
              >
                <option value="intern">Intern</option>
                <option value="full_time">Full-time</option>
                <option value="contract">Contract</option>
              </select>
            </Field>
            <Field label="Full name" required>
              <input
                required
                minLength={2}
                maxLength={120}
                value={form.full_name}
                onChange={(e) => setField("full_name", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Personal email" required>
              <input
                required
                type="email"
                value={form.personal_email}
                onChange={(e) => setField("personal_email", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <input
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Address" required>
              <input
                required
                value={form.address}
                onChange={(e) => setField("address", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Department">
              <input
                value={form.department}
                onChange={(e) => setField("department", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Designation">
              <input
                value={form.designation}
                onChange={(e) => setField("designation", e.target.value)}
                className={inputClass}
              />
            </Field>
            {isIntern && (
              <Field label="College">
                <input
                  value={form.college}
                  onChange={(e) => setField("college", e.target.value)}
                  className={inputClass}
                />
              </Field>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Start date" required>
              <input
                required
                type="date"
                value={form.start_date}
                onChange={(e) => setField("start_date", e.target.value)}
                className={inputClass}
              />
            </Field>
            {needsEndDate && (
              <Field label="End date" required>
                <input
                  required
                  type="date"
                  min={form.start_date}
                  value={form.end_date}
                  onChange={(e) => setField("end_date", e.target.value)}
                  className={inputClass}
                />
              </Field>
            )}
            <Field label="Approving manager work email" required>
              <input
                required
                type="email"
                list="active-managers"
                value={form.approver_email}
                onChange={(e) => setField("approver_email", e.target.value)}
                className={inputClass}
              />
              <datalist id="active-managers">
                {managers.map((manager) => (
                  <option key={manager.id} value={manager.email}>
                    {manager.full_name}
                  </option>
                ))}
              </datalist>
            </Field>
          </div>
          {duration(form.start_date, form.end_date) && (
            <p className="text-[12px] text-ink-soft">
              Duration:{" "}
              <span className="font-medium text-ink">
                {duration(form.start_date, form.end_date)}
              </span>
            </p>
          )}
          {error && (
            <p role="alert" className="text-[12px] text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              <Send />
              {submitting ? "Sending..." : "Send for approval"}
            </Button>
          </div>
        </form>
      </Panel>
      <Panel
        title={`Requests · ${requests.data?.length ?? 0}`}
        meta={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => requests.refetch()}
            disabled={requests.isFetching}
          >
            <RefreshCw className={requests.isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        }
      >
        {requests.isLoading ? (
          <p className="p-8 text-center text-sm text-ink-soft">Loading requests...</p>
        ) : requests.error ? (
          <p className="p-8 text-center text-sm text-destructive">
            Could not load onboarding requests: {requests.error.message}
          </p>
        ) : !requests.data?.length ? (
          <p className="p-8 text-center text-sm text-ink-soft">No onboarding requests yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {requests.data.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                resend={resend}
                resending={resending === request.id}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function RequestRow({
  request,
  resend,
  resending,
}: {
  request: OnboardingRequest;
  resend: (id: string) => void;
  resending: boolean;
}) {
  const typeLabel =
    request.joining_type === "full_time"
      ? "Full-time"
      : request.joining_type.charAt(0).toUpperCase() + request.joining_type.slice(1);
  return (
    <div className="p-4 space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-48">
          <p className="font-medium text-[13px]">{request.full_name}</p>
          <p className="text-[11px] text-ink-soft">
            {typeLabel} · {request.personal_email}
          </p>
        </div>
        <p className="text-[12px] text-ink-soft">
          {formatDate(request.start_date)} → {formatDate(request.end_date)}
          {request.end_date && ` · ${duration(request.start_date, request.end_date)}`}
        </p>
        <div className="ml-auto">
          <StatusPill status={request.status} />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-soft">
        <span>
          Approver: {request.approver_name} ({request.approver_email})
        </span>
        {request.decided_at && (
          <span>Decision: {new Date(request.decided_at).toLocaleString()}</span>
        )}
        {request.decision_note && (
          <span className="text-destructive">Reason: {request.decision_note}</span>
        )}
      </div>
      {request.status === "pending" && request.email_error && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          <span>Email error: {request.email_error}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => resend(request.id)}
            disabled={resending}
          >
            {resending ? "Resending..." : "Resend"}
          </Button>
        </div>
      )}
    </div>
  );
}