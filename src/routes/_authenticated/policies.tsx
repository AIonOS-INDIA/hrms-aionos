import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Panel, StatCard } from "@/components/AppShell";
import { Input, Select } from "@/routes/_authenticated/employees";
import { fmtDate, useHolidays, useLeaveTypes, useMe, usePolicies } from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/policies")({
  head: () => ({
    meta: [
      { title: "Policies — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Company policies, leave entitlements and location holiday calendars for every employee.",
      },
      { property: "og:title", content: "Policies — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Policies, leave entitlements and holiday calendars in one place.",
      },
    ],
  }),
  component: PoliciesPage,
});

function PoliciesPage() {
  return (
    <AppShell title="Policies" subtitle="Policies, leave rules and holidays">
      <PoliciesBody />
    </AppShell>
  );
}

function PoliciesBody() {
  const { data: me } = useMe();
  const { data: policies = [] } = usePolicies();
  const { data: types = [] } = useLeaveTypes();
  const { data: holidays = [] } = useHolidays();
  const queryClient = useQueryClient();
  const canEdit = !!me?.isMaster;

  const [policyForm, setPolicyForm] = useState({ title: "", category: "General", body: "" });
  const [holidayForm, setHolidayForm] = useState({
    name: "",
    holiday_date: new Date().toISOString().slice(0, 10),
    location: "Bengaluru",
  });

  const addPolicy = useMutation({
    mutationFn: async () => {
      if (!policyForm.title.trim()) throw new Error("A policy needs a title");
      const { error } = await supabase.from("policies").insert({
        title: policyForm.title.trim(),
        category: policyForm.category,
        body: policyForm.body,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Policy published to all entities");
      setPolicyForm({ title: "", category: "General", body: "" });
      queryClient.invalidateQueries({ queryKey: ["policies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addHoliday = useMutation({
    mutationFn: async () => {
      if (!holidayForm.name.trim()) throw new Error("A holiday needs a name");
      const { error } = await supabase.from("holidays").insert({
        name: holidayForm.name.trim(),
        holiday_date: holidayForm.holiday_date,
        location: holidayForm.location,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Holiday added to the group calendar");
      setHolidayForm({ ...holidayForm, name: "" });
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateType = useMutation({
    mutationFn: async ({ id, annual_days }: { id: string; annual_days: number }) => {
      const { error } = await supabase.from("leave_types").update({ annual_days }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entitlement updated for every company");
      queryClient.invalidateQueries({ queryKey: ["leave_types"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const locations = Array.from(new Set(holidays.map((h) => h.location)));

  const jumpTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line ring-1 ring-black/5 rounded-[14px] overflow-hidden">
        <StatCard
          label="Published policies"
          value={policies.length}
          onClick={() => jumpTo("policies-section")}
        />
        <StatCard label="Leave types" value={types.length} onClick={() => jumpTo("leave-section")} />
        <StatCard
          label="Holidays"
          value={holidays.length}
          hint="Across locations"
          onClick={() => jumpTo("holidays-section")}
        />
        <StatCard
          label="Locations"
          value={locations.length}
          onClick={() => jumpTo("holidays-section")}
        />
      </section>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <div id="policies-section" className="scroll-mt-24">
          <Panel title="Company policies">
            <div className="divide-y divide-line">
              {policies.map((p) => (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold">{p.title}</span>
                    <span className="label-mono">{p.category}</span>
                  </div>
                  <p className="text-[13px] text-ink-soft mt-1">{p.body}</p>
                </div>
              ))}
              {!policies.length && (
                <p className="px-4 py-8 text-center text-[13px] text-ink-soft">
                  No policies published yet.
                </p>
              )}
            </div>
          </Panel>
          </div>

          <div id="leave-section" className="scroll-mt-24">
          <Panel title="Leave entitlements">
            <div className="divide-y divide-line">
              {types.map((t) => (
                <div key={t.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold">{t.name}</p>
                    <p className="text-[11px] font-mono text-ink-soft">
                      {t.code} · carry forward {t.carry_forward_days}d
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {canEdit ? (
                      <input
                        defaultValue={t.annual_days}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isNaN(v) && v !== t.annual_days)
                            updateType.mutate({ id: t.id, annual_days: v });
                        }}
                        className="h-8 w-20 px-2 rounded-md bg-paper ring-1 ring-line text-[13px] font-mono text-center outline-none focus:ring-ink"
                      />
                    ) : (
                      <span className="text-[13px] font-mono">{t.annual_days}</span>
                    )}
                    <span className="text-[11px] font-mono text-ink-soft">days / year</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          </div>

          <div id="holidays-section" className="scroll-mt-24">
          <Panel title="Holiday calendar by location">
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {locations.map((loc) => (
                <div key={loc} className="rounded-md bg-paper ring-1 ring-black/5 p-3">
                  <p className="label-mono">{loc}</p>
                  <ul className="mt-2 space-y-1.5">
                    {holidays
                      .filter((h) => h.location === loc)
                      .map((h) => (
                        <li key={h.id} className="flex items-center justify-between text-[13px]">
                          <span>{h.name}</span>
                          <span className="font-mono text-[12px] text-ink-soft">
                            {fmtDate(h.holiday_date)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
              {!holidays.length && (
                <p className="text-[13px] text-ink-soft">No holidays configured.</p>
              )}
            </div>
          </Panel>
          </div>
        </div>


        <aside className="panelin space-y-4">
          {canEdit ? (
            <>
              <Panel title="Publish a policy">
                <div className="p-4 space-y-3">
                  <Input
                    label="Title"
                    value={policyForm.title}
                    onChange={(v) => setPolicyForm({ ...policyForm, title: v })}
                  />
                  <Select
                    label="Category"
                    value={policyForm.category}
                    onChange={(v) => setPolicyForm({ ...policyForm, category: v })}
                    options={["General", "Leave", "Attendance", "Conduct", "Benefits"].map((c) => ({
                      value: c,
                      label: c,
                    }))}
                  />
                  <div>
                    <p className="label-mono mb-1">Details</p>
                    <textarea
                      rows={4}
                      value={policyForm.body}
                      onChange={(e) => setPolicyForm({ ...policyForm, body: e.target.value })}
                      className="w-full p-2 rounded-md bg-paper ring-1 ring-line text-[13px] outline-none focus:ring-ink resize-none"
                    />
                  </div>
                  <button
                    disabled={addPolicy.isPending}
                    onClick={() => addPolicy.mutate()}
                    className="w-full h-10 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
                  >
                    Publish to all entities
                  </button>
                </div>
              </Panel>

              <Panel title="Add a holiday">
                <div className="p-4 space-y-3">
                  <Input
                    label="Name"
                    value={holidayForm.name}
                    onChange={(v) => setHolidayForm({ ...holidayForm, name: v })}
                  />
                  <Input
                    label="Date"
                    type="date"
                    value={holidayForm.holiday_date}
                    onChange={(v) => setHolidayForm({ ...holidayForm, holiday_date: v })}
                  />
                  <Select
                    label="Location"
                    value={holidayForm.location}
                    onChange={(v) => setHolidayForm({ ...holidayForm, location: v })}
                    options={["Bengaluru", "London", "Austin", "Singapore"].map((l) => ({
                      value: l,
                      label: l,
                    }))}
                  />
                  <button
                    disabled={addHoliday.isPending}
                    onClick={() => addHoliday.mutate()}
                    className="w-full h-10 rounded-md ring-1 ring-line text-[13px] font-semibold cursor-pointer hover:bg-ink/5 disabled:opacity-50"
                  >
                    Add to calendar
                  </button>
                </div>
              </Panel>
            </>
          ) : (
            <div className="rounded-[14px] bg-brand text-paper p-4">
              <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-paper/50">
                Good to know
              </p>
              <p className="text-[13px] mt-2">
                These policies, leave entitlements and holiday dates apply to you and your team.
                Reach out to HR if something looks out of date.
              </p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
