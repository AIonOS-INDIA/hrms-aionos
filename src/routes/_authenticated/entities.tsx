import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EntityTag, Panel, StatCard } from "@/components/AppShell";
import { Input, Select } from "@/routes/_authenticated/employees";
import { MasterDataPanel } from "@/components/MasterDataPanel";
import {
  applyPaySettings,
  money,
  useCompanies,
  useEmployees,
  useEntityPaySettings,
  useMe,
  DEFAULT_PAY_SETTINGS,
  type Company,
  type EntityPaySettings,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/entities")({
  head: () => ({
    meta: [
      { title: "Entity setup — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Set up each legal entity with its email domain, salary structure split and deduction rules used for payroll and exit settlements.",
      },
      { property: "og:title", content: "Entity setup — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Legal entities, email domains, salary structure and deduction rules.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EntitiesPage,
});

function EntitiesPage() {
  return (
    <AppShell title="Entity setup" subtitle="Legal entity · domain · salary and deduction rules">
      <EntitiesBody />
    </AppShell>
  );
}

const ACCENTS = [
  { value: "aionos", label: "AIONOS" },
  { value: "perp", label: "Green" },
  { value: "whilter", label: "Amber" },
  { value: "cloud", label: "Blue" },
  { value: "inetum", label: "Purple" },
];

const cleanDomain = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "");

type PayForm = Record<keyof typeof DEFAULT_PAY_SETTINGS, string | boolean>;

function toForm(s: EntityPaySettings | undefined): PayForm {
  const base = s ?? DEFAULT_PAY_SETTINGS;
  return {
    currency: String(base.currency),
    basic_percent: String(base.basic_percent),
    hra_percent: String(base.hra_percent),
    allowance_percent: String(base.allowance_percent),
    pf_percent: String(base.pf_percent),
    professional_tax: String(base.professional_tax),
    insurance_monthly: String(base.insurance_monthly),
    other_deduction: String(base.other_deduction),
    tax_percent: String(base.tax_percent),
    working_days_per_month: String(base.working_days_per_month),
    notice_period_days: String(base.notice_period_days),
    encash_leave_on_exit: Boolean(base.encash_leave_on_exit),
    notes: String(base.notes ?? ""),
  };
}

function numbers(f: PayForm) {
  const n = (v: string | boolean) => Number(v) || 0;
  return {
    currency: String(f.currency || "INR"),
    basic_percent: n(f.basic_percent),
    hra_percent: n(f.hra_percent),
    allowance_percent: n(f.allowance_percent),
    pf_percent: n(f.pf_percent),
    professional_tax: n(f.professional_tax),
    insurance_monthly: n(f.insurance_monthly),
    other_deduction: n(f.other_deduction),
    tax_percent: n(f.tax_percent),
    working_days_per_month: n(f.working_days_per_month),
    notice_period_days: n(f.notice_period_days),
    encash_leave_on_exit: Boolean(f.encash_leave_on_exit),
    notes: String(f.notes ?? ""),
  };
}

function EntitiesBody() {
  const { data: me } = useMe();
  const { data: companies = [] } = useCompanies();
  const { data: employees = [] } = useEmployees();
  const { data: settings = [] } = useEntityPaySettings();
  const queryClient = useQueryClient();
  const canEdit = !!me?.isMaster;

  const [selectedId, setSelectedId] = useState("");
  const selected: Company | undefined =
    companies.find((c) => c.id === selectedId) ?? companies[0];

  const current = settings.find((s) => s.company_id === selected?.id);

  const [entity, setEntity] = useState({ name: "", code: "", email_domain: "", accent: "cloud" });
  const [pay, setPay] = useState<PayForm>(toForm(undefined));
  const [loadedFor, setLoadedFor] = useState("");
  if (selected && loadedFor !== selected.id) {
    setLoadedFor(selected.id);
    setEntity({
      name: selected.name,
      code: selected.code,
      email_domain: selected.email_domain,
      accent: selected.accent,
    });
    setPay(toForm(current));
  }

  const split =
    Number(pay.basic_percent) + Number(pay.hra_percent) + Number(pay.allowance_percent);
  const sample = useMemo(
    () => applyPaySettings(1_200_000, { ...DEFAULT_PAY_SETTINGS, ...numbers(pay) }),
    [pay],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["companies"] });
    queryClient.invalidateQueries({ queryKey: ["entity_pay_settings"] });
  };

  const saveEntity = useMutation({
    mutationFn: async () => {
      const domain = cleanDomain(entity.email_domain);
      if (!entity.name.trim() || !entity.code.trim() || !domain)
        throw new Error("Name, short code and email domain are all needed");
      const payload = {
        name: entity.name.trim(),
        code: entity.code.trim().toUpperCase(),
        email_domain: domain,
        accent: entity.accent,
      };
      if (selected) {
        const { error } = await supabase.from("companies").update(payload).eq("id", selected.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("companies")
          .insert({ ...payload, is_parent: false })
          .select("id")
          .single();
        if (error) throw error;
        await supabase.from("entity_pay_settings").insert({ company_id: data.id });
        setSelectedId(data.id);
      }
    },
    onSuccess: () => {
      toast.success("Entity saved");
      setLoadedFor("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePay = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick an entity first");
      if (Math.round(split) !== 100)
        throw new Error("Basic, house rent and allowances must add up to 100%");
      const values = { company_id: selected.id, ...numbers(pay) };
      const { error } = await supabase
        .from("entity_pay_settings")
        .upsert(values, { onConflict: "company_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Salary and deduction rules saved");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startNew = () => {
    setSelectedId("");
    setLoadedFor("new");
    setEntity({ name: "", code: "", email_domain: "", accent: "cloud" });
    setPay(toForm(undefined));
  };

  const num = (key: keyof typeof DEFAULT_PAY_SETTINGS, label: string) => (
    <Input
      label={label}
      type="number"
      value={String(pay[key])}
      onChange={(v) => setPay({ ...pay, [key]: v })}
      disabled={!canEdit}
    />
  );

  const configured = settings.length;

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Legal entities" value={companies.length} hint="in the group" />
        <StatCard
          label="Pay rules set"
          value={configured}
          hint={configured === companies.length ? "all entities" : "some entities pending"}
          hintTone={configured === companies.length ? "good" : "warn"}
        />
        <StatCard
          label="People covered"
          value={employees.filter((e) => e.status !== "offboarded").length}
          hint="active staff"
        />
        <StatCard
          label="Selected entity"
          value={selected?.code ?? "—"}
          hint={selected ? `@${selected.email_domain}` : "new entity"}
        />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        <Panel
          title="Entities"
          meta={
            canEdit ? (
              <button
                type="button"
                onClick={startNew}
                className="h-7 px-2.5 rounded-md text-[12px] ring-1 ring-line hover:bg-ink/5 cursor-pointer"
              >
                Add entity
              </button>
            ) : undefined
          }
        >
          <div className="divide-y divide-line">
            {companies.map((c) => {
              const has = settings.some((s) => s.company_id === c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-4 py-3 cursor-pointer hover:bg-brand/5 ${
                    selected?.id === c.id ? "bg-brand/8" : ""
                  }`}
                >
                  <EntityTag company={c} />
                  <p className="label-mono truncate">
                    @{c.email_domain} · {has ? "pay rules set" : "no pay rules"}
                  </p>
                </button>
              );
            })}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title={selected ? `${selected.name} · details` : "New legal entity"}>
            <form
              className="p-4 grid sm:grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveEntity.mutate();
              }}
            >
              <Input
                label="Entity name"
                value={entity.name}
                onChange={(v) => setEntity({ ...entity, name: v })}
                disabled={!canEdit}
              />
              <Input
                label="Short code"
                value={entity.code}
                onChange={(v) =>
                  setEntity({ ...entity, code: v.toUpperCase().replace(/\s+/g, "") })
                }
                disabled={!canEdit}
              />
              <Input
                label="Email domain"
                value={entity.email_domain}
                onChange={(v) => setEntity({ ...entity, email_domain: v })}
                disabled={!canEdit}
              />
              <Select
                label="Colour"
                value={entity.accent}
                onChange={(v) => setEntity({ ...entity, accent: v })}
                options={ACCENTS}
                disabled={!canEdit}
              />
              <p className="sm:col-span-2 label-mono">
                People here sign in as name@{cleanDomain(entity.email_domain) || "domain"}
              </p>
              {canEdit && (
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={saveEntity.isPending}
                    className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-medium disabled:opacity-40 cursor-pointer"
                  >
                    {saveEntity.isPending ? "Saving…" : selected ? "Save entity" : "Add entity"}
                  </button>
                </div>
              )}
            </form>
          </Panel>

          <Panel
            title="Salary structure"
            meta={
              <span className={`label-mono ${Math.round(split) === 100 ? "" : "text-destructive"}`}>
                {split}% of monthly pay
              </span>
            }
          >
            <div className="p-4 grid sm:grid-cols-3 gap-3">
              <Input
                label="Currency"
                value={String(pay.currency)}
                onChange={(v) => setPay({ ...pay, currency: v.toUpperCase() })}
                disabled={!canEdit}
              />
              {num("basic_percent", "Basic %")}
              {num("hra_percent", "House rent %")}
              {num("allowance_percent", "Allowances %")}
              {num("working_days_per_month", "Working days a month")}
              {num("notice_period_days", "Notice period (days)")}
            </div>
          </Panel>

          <Panel title="Deduction rules">
            <div className="p-4 grid sm:grid-cols-3 gap-3">
              {num("pf_percent", "Provident fund % of basic")}
              {num("professional_tax", "Professional tax / month")}
              {num("insurance_monthly", "Insurance / month")}
              {num("other_deduction", "Other deduction / month")}
              {num("tax_percent", "Income tax %")}
              <label className="flex items-end gap-2 text-[13px] pb-2">
                <input
                  type="checkbox"
                  className="size-4 accent-black cursor-pointer"
                  checked={Boolean(pay.encash_leave_on_exit)}
                  disabled={!canEdit}
                  onChange={(e) => setPay({ ...pay, encash_leave_on_exit: e.target.checked })}
                />
                Pay out unused leave on exit
              </label>
              <div className="sm:col-span-3">
                <Input
                  label="Notes for HR and finance"
                  value={String(pay.notes)}
                  onChange={(v) => setPay({ ...pay, notes: v })}
                  disabled={!canEdit}
                />
              </div>
              <div className="sm:col-span-3 rounded-md ring-1 ring-line p-3 text-[13px]">
                <p className="label-mono mb-1.5">
                  Example on {money(1_200_000, String(pay.currency) || "INR")} a year
                </p>
                <p className="text-ink-soft">
                  Basic {money(sample.monthlyBasic, String(pay.currency))} · House rent{" "}
                  {money(sample.monthlyHra, String(pay.currency))} · Allowances{" "}
                  {money(sample.monthlyAllowances, String(pay.currency))} · Deductions{" "}
                  {money(sample.monthlyDeductions, String(pay.currency))} · Tax{" "}
                  {money(sample.tax, String(pay.currency))} ·{" "}
                  <b className="text-ink">Take home {money(sample.net, String(pay.currency))}</b>
                </p>
              </div>
              {canEdit && (
                <div className="sm:col-span-3">
                  <button
                    type="button"
                    onClick={() => savePay.mutate()}
                    disabled={savePay.isPending || !selected}
                    className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-medium disabled:opacity-40 cursor-pointer"
                  >
                    {savePay.isPending ? "Saving…" : "Save pay rules"}
                  </button>
                </div>
              )}
            </div>
          </Panel>

          <MasterDataPanel
            companyId={selected?.id}
            companyName={selected?.name ?? ""}
            canEdit={
              !!selected &&
              (!!me?.isMaster || (me?.hrCompanyIds ?? []).includes(selected.id))
            }
          />
        </div>
      </div>
    </>
  );
}
