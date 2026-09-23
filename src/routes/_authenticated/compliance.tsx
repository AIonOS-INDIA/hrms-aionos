import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EntityTag, FilterNote, Panel, StatCard, useScope } from "@/components/AppShell";
import { Input, Select } from "@/routes/_authenticated/employees";
import { fmtDate, useComplianceDocuments, useEmployees, useMe } from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/compliance")({
  head: () => ({
    meta: [
      { title: "Documents — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Track statutory registrations, contracts, visas and certificates with expiry reminders for every company.",
      },
      { property: "og:title", content: "Documents — AIONOS HR Control Tower" },
      { property: "og:description", content: "Records, renewals and expiry tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompliancePage,
});

function CompliancePage() {
  return (
    <AppShell title="Documents" subtitle="Records · renewals · expiry">
      <ComplianceBody />
    </AppShell>
  );
}

const DOC_TYPES = [
  "Statutory registration",
  "Employment contract",
  "Visa / work permit",
  "Certification",
  "Insurance",
  "Audit report",
  "Other",
];

function daysUntil(date: string | null) {
  if (!date) return null;
  return Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
}

function ComplianceBody() {
  const { data: me } = useMe();
  const { companyId, companyById, canSeeAll, companies } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: docs = [] } = useComplianceDocuments();
  const queryClient = useQueryClient();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId;
  const myId = me?.employee?.id;
  const targetCompany = companyId ?? me?.hrCompanyId ?? companies[0]?.id ?? "";

  const visible = useMemo(() => {
    const inScope = companyId ? docs.filter((d) => d.company_id === companyId) : docs;
    return isHr ? inScope : docs.filter((d) => d.employee_id === myId);
  }, [docs, companyId, isHr, myId]);

  const [tile, setTile] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    doc_type: DOC_TYPES[0] as string,
    reference: "",
    issued_on: "",
    expires_on: "",
    employee_id: "",
    notes: "",
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["compliance_documents"] });

  const addDoc = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name the document");
      if (!targetCompany) throw new Error("Pick a company first");
      const { error } = await supabase.from("compliance_documents").insert({
        company_id: targetCompany,
        employee_id: form.employee_id || null,
        name: form.name.trim(),
        doc_type: form.doc_type,
        reference: form.reference,
        issued_on: form.issued_on || null,
        expires_on: form.expires_on || null,
        notes: form.notes,
        status: "valid",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Document recorded");
      setForm({ ...form, name: "", reference: "", notes: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renew = useMutation({
    mutationFn: async ({ id, expires_on }: { id: string; expires_on: string }) => {
      const { error } = await supabase
        .from("compliance_documents")
        .update({ expires_on, status: "valid" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Renewal saved");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeDoc = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("compliance_documents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const expired = visible.filter((d) => {
    const n = daysUntil(d.expires_on);
    return n !== null && n < 0;
  });
  const expiring = visible.filter((d) => {
    const n = daysUntil(d.expires_on);
    return n !== null && n >= 0 && n <= 60;
  });

  const scoped = companyId ? employees.filter((e) => e.company_id === companyId) : employees;

  const expiredIds = new Set(expired.map((d) => d.id));
  const expiringIds = new Set(expiring.map((d) => d.id));
  const shown =
    tile === "expired"
      ? expired
      : tile === "expiring"
        ? expiring
        : tile === "valid"
          ? visible.filter((d) => !expiredIds.has(d.id) && !expiringIds.has(d.id))
          : visible;
  const toggle = (k: string) => setTile((prev) => (prev === k ? null : k));

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Documents"
          value={visible.length}
          hint="on record"
          onClick={() => setTile(null)}
          active={tile === null}
        />
        <StatCard
          label="Valid"
          value={visible.length - expired.length - expiring.length}
          hintTone="good"
          onClick={() => toggle("valid")}
          active={tile === "valid"}
        />
        <StatCard
          label="Expiring soon"
          value={expiring.length}
          hintTone="warn"
          hint="next 60 days"
          onClick={() => toggle("expiring")}
          active={tile === "expiring"}
        />
        <StatCard
          label="Expired"
          value={expired.length}
          hintTone="warn"
          hint="renew now"
          onClick={() => toggle("expired")}
          active={tile === "expired"}
        />
      </section>
      {tile && <FilterNote label={tile} count={shown.length} onClear={() => setTile(null)} />}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <Panel
            title={isHr ? "All documents" : "My documents"}
            meta={<span className="label-mono">{shown.length} records</span>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-mono border-b border-line">
                    <th className="px-4 py-2.5 font-medium">Document</th>
                    {canSeeAll && isHr && <th className="px-4 py-2.5 font-medium">Entity</th>}
                    <th className="px-4 py-2.5 font-medium">Linked to</th>
                    <th className="px-4 py-2.5 font-medium">Valid until</th>
                    {isHr && <th className="px-4 py-2.5 font-medium text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((d) => {
                    const n = daysUntil(d.expires_on);
                    const tone =
                      n === null
                        ? "text-ink-soft"
                        : n < 0
                          ? "text-destructive"
                          : n <= 60
                            ? "text-whilter"
                            : "text-perp";
                    return (
                      <tr key={d.id} className="hover:bg-ink/[0.03]">
                        <td className="px-4 py-3">
                          <p className="font-medium">{d.name}</p>
                          <p className="text-[11px] font-mono text-ink-soft">
                            {d.doc_type}
                            {d.reference ? ` · ${d.reference}` : ""}
                          </p>
                        </td>
                        {canSeeAll && isHr && (
                          <td className="px-4 py-3">
                            <EntityTag company={companyById(d.company_id)} />
                          </td>
                        )}
                        <td className="px-4 py-3 text-ink-soft">
                          {d.employee_id
                            ? (employees.find((e) => e.id === d.employee_id)?.full_name ?? "—")
                            : "Company"}
                        </td>
                        <td className={`px-4 py-3 font-mono text-[12px] ${tone}`}>
                          {d.expires_on ? fmtDate(d.expires_on) : "no expiry"}
                          {n !== null && n < 0 ? " · expired" : ""}
                          {n !== null && n >= 0 && n <= 60 ? ` · ${n}d left` : ""}
                        </td>
                        {isHr && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="date"
                                onChange={(e) =>
                                  e.target.value &&
                                  renew.mutate({ id: d.id, expires_on: e.target.value })
                                }
                                className="h-7 px-1.5 rounded-md bg-paper ring-1 ring-line text-[11px] cursor-pointer"
                              />
                              <button
                                onClick={() => removeDoc.mutate(d.id)}
                                className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium text-destructive cursor-pointer hover:bg-ink/5"
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {!shown.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                        Nothing on record yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {isHr && (
          <aside>
            <Panel title="Record a document">
              <div className="p-4 space-y-3">
                <Input
                  label="Name"
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                />
                <Select
                  label="Type"
                  value={form.doc_type}
                  onChange={(v) => setForm({ ...form, doc_type: v })}
                  options={DOC_TYPES.map((t) => ({ value: t, label: t }))}
                />
                <Input
                  label="Reference number"
                  value={form.reference}
                  onChange={(v) => setForm({ ...form, reference: v })}
                />
                <Select
                  label="Linked to"
                  value={form.employee_id}
                  onChange={(v) => setForm({ ...form, employee_id: v })}
                  options={[
                    { value: "", label: "The company" },
                    ...scoped.map((e) => ({ value: e.id, label: e.full_name })),
                  ]}
                />
                <Input
                  label="Issued on"
                  type="date"
                  value={form.issued_on}
                  onChange={(v) => setForm({ ...form, issued_on: v })}
                />
                <Input
                  label="Valid until"
                  type="date"
                  value={form.expires_on}
                  onChange={(v) => setForm({ ...form, expires_on: v })}
                />
                <button
                  onClick={() => addDoc.mutate()}
                  className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                >
                  Save document
                </button>
              </div>
            </Panel>
          </aside>
        )}
      </div>
    </>
  );
}
