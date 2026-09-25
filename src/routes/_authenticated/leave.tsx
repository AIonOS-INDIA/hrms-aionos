import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, FilterNote, EntityTag, Panel, StatCard, StatusPill, useScope } from "@/components/AppShell";
import { Input, Select } from "@/routes/_authenticated/employees";
import {
  daysBetween,
  fmtDate,
  useEmployees,
  useLeaveBalances,
  useLeaveRequests,
  useLeaveTypes,
  useMe,
} from "@/lib/hrms";
import { queueApprovalCards } from "@/lib/actionable-cards.functions";

export const Route = createFileRoute("/_authenticated/leave")({
  head: () => ({
    meta: [
      { title: "Leave — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Apply for leave, track balances and approve requests under the AIONOS group leave policy.",
      },
      { property: "og:title", content: "Leave — AIONOS HR Control Tower" },
      { property: "og:description", content: "Leave requests, balances and approvals." },
    ],
  }),
  component: LeavePage,
});

function LeavePage() {
  return (
    <AppShell title="Leave" subtitle="Balances, requests and approvals">
      <LeaveBody />
    </AppShell>
  );
}

function LeaveBody() {
  const { data: me } = useMe();
  const { companyId, companyById, canSeeAll } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: types = [] } = useLeaveTypes();
  const { data: requests = [] } = useLeaveRequests();
  const { data: balances = [] } = useLeaveBalances(me?.employee?.id);
  const queryClient = useQueryClient();
  const queueCards = useServerFn(queueApprovalCards);

  const isHr = !!me?.isMaster || !!me?.hrCompanyId;
  const myId = me?.employee?.id;

  const [tile, setTile] = useState<string | null>(null);
  const [form, setForm] = useState({
    leave_type_id: "",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    reason: "",
  });

  const scopedEmployeeIds = useMemo(
    () =>
      new Set(
        (companyId ? employees.filter((e) => e.company_id === companyId) : employees).map(
          (e) => e.id,
        ),
      ),
    [employees, companyId],
  );

  const teamRequests = requests.filter(
    (r) => scopedEmployeeIds.has(r.employee_id) && r.employee_id !== myId,
  );
  const myRequests = requests.filter((r) => r.employee_id === myId);

  const apply = useMutation({
    mutationFn: async () => {
      if (!myId) throw new Error("Your employee record is not linked yet");
      const typeId = form.leave_type_id || types[0]?.id;
      if (!typeId) throw new Error("Pick a leave type");
      if (form.end_date < form.start_date) throw new Error("End date is before the start date");
      const { data, error } = await supabase.from("leave_requests").insert({
        employee_id: myId,
        leave_type_id: typeId,
        start_date: form.start_date,
        end_date: form.end_date,
        days: daysBetween(form.start_date, form.end_date),
        reason: form.reason,
        status: "pending",
      }).select("id").single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      toast.success("Leave request submitted");
      void queueCards({ data: { kind: "leave", id } }).catch(() => undefined);
      setForm({ ...form, reason: "" });
      queryClient.invalidateQueries({ queryKey: ["leave_requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("leave_requests")
        .update({ status, decided_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Decision recorded");
      queryClient.invalidateQueries({ queryKey: ["leave_requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("leave_requests")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request cancelled");
      queryClient.invalidateQueries({ queryKey: ["leave_requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = teamRequests.filter((r) => r.status === "pending");
  const toggle = (k: string) => setTile((prev) => (prev === k ? null : k));
  const shownTeam = tile === "pending" ? pending : teamRequests;
  const shownMine =
    tile === "pending" ? myRequests.filter((r) => r.status === "pending") : myRequests;

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {balances.slice(0, 3).map((b) => {
          const t = types.find((x) => x.id === b.leave_type_id);
          return (
            <StatCard
              key={b.id}
              label={t?.name ?? "Leave"}
              value={Number(b.entitled_days) - Number(b.used_days)}
              suffix="d left"
              hint={`${b.used_days} of ${b.entitled_days} used`}
              onClick={() => setTile(null)}
              active={false}
            />
          );
        })}
        <StatCard
          label={isHr ? "Awaiting your decision" : "My pending requests"}
          value={isHr ? pending.length : myRequests.filter((r) => r.status === "pending").length}
          hintTone="warn"
          hint="click to filter"
          onClick={() => toggle("pending")}
          active={tile === "pending"}
        />
      </section>
      {tile && (
        <FilterNote
          label="pending requests"
          count={isHr ? shownTeam.length : shownMine.length}
          onClear={() => setTile(null)}
        />
      )}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          {isHr && (
            <Panel title={`Team requests · ${shownTeam.length}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left label-mono border-b border-line">
                      <th className="px-4 py-2.5 font-medium">Employee</th>
                      {canSeeAll && (
                        <th className="px-4 py-2.5 font-medium hidden md:table-cell">Entity</th>
                      )}
                      <th className="px-4 py-2.5 font-medium">Type</th>
                      <th className="px-4 py-2.5 font-medium">Dates</th>
                      <th className="px-4 py-2.5 font-medium text-right">Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shownTeam.map((r) => {
                      const emp = employees.find((e) => e.id === r.employee_id);
                      return (
                        <tr key={r.id} className="hover:bg-ink/[0.03]">
                          <td className="px-4 py-3">
                            <p className="font-medium">{emp?.full_name}</p>
                            <p className="text-[11px] font-mono text-ink-soft">{r.reason || "—"}</p>
                          </td>
                          {canSeeAll && (
                            <td className="px-4 py-3 hidden md:table-cell">
                              <EntityTag
                                company={emp ? companyById(emp.company_id) : undefined}
                              />
                            </td>
                          )}
                          <td className="px-4 py-3 text-ink-soft">
                            {types.find((t) => t.id === r.leave_type_id)?.name}
                          </td>
                          <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                            {fmtDate(r.start_date)} → {fmtDate(r.end_date)} · {r.days}d
                          </td>
                          <td className="px-4 py-3 text-right">
                            {r.status === "pending" ? (
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() => decide.mutate({ id: r.id, status: "approved" })}
                                  className="h-7 px-2.5 rounded-md bg-brand text-paper text-[11px] font-semibold cursor-pointer hover:bg-brand-deep"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => decide.mutate({ id: r.id, status: "rejected" })}
                                  className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                                >
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <StatusPill status={r.status} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!shownTeam.length && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                          No requests in this scope.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <Panel title={`My requests · ${myRequests.length}`}>
            <div className="divide-y divide-line">
              {shownMine.map((r) => (
                <div key={r.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div>
                    <p className="text-[13px] font-medium">
                      {types.find((t) => t.id === r.leave_type_id)?.name}
                    </p>
                    <p className="text-[11px] font-mono text-ink-soft">
                      {fmtDate(r.start_date)} → {fmtDate(r.end_date)} · {r.days}d
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <StatusPill status={r.status} />
                    {r.status === "pending" && (
                      <button
                        onClick={() => cancel.mutate(r.id)}
                        className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!shownMine.length && (
                <p className="px-4 py-8 text-center text-[13px] text-ink-soft">
                  You have not applied for leave yet.
                </p>
              )}
            </div>
          </Panel>
        </div>

        <aside className="panelin space-y-4">
          <Panel title="Apply for leave">
            <div className="p-4 space-y-3">
              <Select
                label="Leave type"
                value={form.leave_type_id || (types[0]?.id ?? "")}
                onChange={(v) => setForm({ ...form, leave_type_id: v })}
                options={types.map((t) => ({ value: t.id, label: `${t.name} · ${t.annual_days}d` }))}
              />
              <Input
                label="From"
                type="date"
                value={form.start_date}
                onChange={(v) => setForm({ ...form, start_date: v })}
              />
              <Input
                label="To"
                type="date"
                value={form.end_date}
                onChange={(v) => setForm({ ...form, end_date: v })}
              />
              <Input
                label="Reason"
                value={form.reason}
                onChange={(v) => setForm({ ...form, reason: v })}
              />
              <p className="text-[11px] font-mono text-ink-soft">
                {daysBetween(form.start_date, form.end_date)} calendar day(s)
              </p>
              <button
                disabled={apply.isPending || !me?.employee}
                onClick={() => apply.mutate()}
                className="w-full h-10 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
              >
                {apply.isPending ? "Submitting…" : "Submit request"}
              </button>
            </div>
          </Panel>

          <Panel title="My balances">
            <div className="p-4 space-y-3">
              {balances.map((b) => {
                const t = types.find((x) => x.id === b.leave_type_id);
                const pct = b.entitled_days
                  ? Math.min(100, (Number(b.used_days) / Number(b.entitled_days)) * 100)
                  : 0;
                return (
                  <div key={b.id}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span>{t?.name}</span>
                      <span className="font-mono text-[12px] text-ink-soft">
                        {b.used_days} / {b.entitled_days} d
                      </span>
                    </div>
                    <div className="h-1.5 mt-1.5 rounded-full bg-line overflow-hidden">
                      <div className="h-full bg-perp" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {!balances.length && (
                <p className="text-[13px] text-ink-soft">No balances allocated yet.</p>
              )}
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
