import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/AppShell";
import { Combo, Input, Select } from "@/routes/_authenticated/employees";
import {
  ASSET_CATEGORY_LABEL,
  ASSET_STATE_LABEL,
  ASSET_TYPE_SUGGESTIONS,
  canManageAssets,
  fmtDate,
  money,
  useEmployeeAssets,
  useMe,
  type AssetCategory,
  type AssetState,
  type Employee,
  type EmployeeAsset,
} from "@/lib/hrms";

type Draft = {
  category: AssetCategory;
  asset_type: string;
  name: string;
  make_model: string;
  serial_number: string;
  asset_tag: string;
  vendor: string;
  license_key: string;
  quantity: string;
  assigned_on: string;
  return_due: string;
  status: AssetState;
  cost: string;
  currency: string;
  renewal_date: string;
  notes: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyDraft = (): Draft => ({
  category: "hardware",
  asset_type: "Laptop",
  name: "",
  make_model: "",
  serial_number: "",
  asset_tag: "",
  vendor: "",
  license_key: "",
  quantity: "1",
  assigned_on: today(),
  return_due: "",
  status: "assigned",
  cost: "0",
  currency: "INR",
  renewal_date: "",
  notes: "",
});

const fromAsset = (a: EmployeeAsset): Draft => ({
  category: a.category,
  asset_type: a.asset_type,
  name: a.name,
  make_model: a.make_model,
  serial_number: a.serial_number,
  asset_tag: a.asset_tag,
  vendor: a.vendor,
  license_key: a.license_key,
  quantity: String(a.quantity),
  assigned_on: a.assigned_on,
  return_due: a.return_due ?? "",
  status: a.status,
  cost: String(a.cost),
  currency: a.currency,
  renewal_date: a.renewal_date ?? "",
  notes: a.notes,
});

/** Everything issued to one person: hardware, accessories, licences and subscriptions. */
export function AssetPanel({ employee, compact }: { employee: Employee; compact?: boolean }) {
  const { data: me } = useMe();
  const { data: assets = [] } = useEmployeeAssets();
  const queryClient = useQueryClient();
  const canEdit = canManageAssets(me, employee.company_id);

  const rows = useMemo(
    () => assets.filter((a) => a.employee_id === employee.id),
    [assets, employee.id],
  );
  const open = rows.filter((a) => a.status === "assigned");

  const [editingId, setEditingId] = useState<string>("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [showForm, setShowForm] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["employee_assets"] });

  const payload = () => ({
    employee_id: employee.id,
    company_id: employee.company_id,
    category: draft.category,
    asset_type: draft.asset_type.trim(),
    name: draft.name.trim(),
    make_model: draft.make_model.trim(),
    serial_number: draft.serial_number.trim(),
    asset_tag: draft.asset_tag.trim(),
    vendor: draft.vendor.trim(),
    license_key: draft.license_key.trim(),
    quantity: Number(draft.quantity) || 1,
    assigned_on: draft.assigned_on || today(),
    return_due: draft.return_due || null,
    status: draft.status,
    cost: Number(draft.cost) || 0,
    currency: draft.currency.trim() || "INR",
    renewal_date: draft.renewal_date || null,
    notes: draft.notes.trim(),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!draft.name.trim()) throw new Error("Give the item a name");
      if (editingId) {
        const { error } = await supabase
          .from("employee_assets")
          .update(payload())
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("employee_assets").insert(payload());
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Asset updated" : "Asset added");
      setEditingId("");
      setDraft(emptyDraft());
      setShowForm(false);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setState = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AssetState }) => {
      const { error } = await supabase
        .from("employee_assets")
        .update({ status, returned_on: status === "assigned" ? null : today() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_assets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Asset removed");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Panel
      title={`Assets · ${rows.length}`}
      meta={
        canEdit ? (
          <button
            onClick={() => {
              setEditingId("");
              setDraft(emptyDraft());
              setShowForm((v) => !v);
            }}
            className="h-7 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
          >
            {showForm ? "Close" : "+ Add asset"}
          </button>
        ) : (
          <span className="label-mono">{open.length} still out</span>
        )
      }
    >
      <div className="p-4 space-y-3">
        {!rows.length && (
          <p className="text-[13px] text-ink-soft">
            Nothing issued to this person yet — laptops, accessories, software licences and
            subscriptions all live here.
          </p>
        )}

        {rows.map((a) => (
          <div key={a.id} className="rounded-md ring-1 ring-line p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium truncate">
                  {a.name}
                  {a.make_model ? ` · ${a.make_model}` : ""}
                </p>
                <p className="text-[11px] font-mono text-ink-soft">
                  {ASSET_CATEGORY_LABEL[a.category]}
                  {a.asset_type ? ` · ${a.asset_type}` : ""}
                  {a.serial_number ? ` · SN ${a.serial_number}` : ""}
                  {a.asset_tag ? ` · Tag ${a.asset_tag}` : ""}
                </p>
                <p className="text-[11px] font-mono text-ink-soft">
                  Issued {fmtDate(a.assigned_on)}
                  {a.renewal_date ? ` · renews ${fmtDate(a.renewal_date)}` : ""}
                  {a.returned_on ? ` · returned ${fmtDate(a.returned_on)}` : ""}
                  {Number(a.cost) ? ` · ${money(Number(a.cost), a.currency)}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  a.status === "assigned"
                    ? "bg-whilter/10 text-whilter"
                    : a.status === "returned"
                      ? "bg-perp/10 text-perp"
                      : "bg-ink/10 text-ink-soft"
                }`}
              >
                {ASSET_STATE_LABEL[a.status]}
              </span>
            </div>
            {a.notes && <p className="mt-1.5 text-[12px] text-ink-soft">{a.notes}</p>}
            {canEdit && (
              <div className="mt-2 flex flex-wrap gap-2">
                {a.status === "assigned" && (
                  <button
                    onClick={() => setState.mutate({ id: a.id, status: "returned" })}
                    className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                  >
                    Mark returned
                  </button>
                )}
                <button
                  onClick={() => {
                    setEditingId(a.id);
                    setDraft(fromAsset(a));
                    setShowForm(true);
                  }}
                  className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                >
                  Edit
                </button>
                <button
                  onClick={() => remove.mutate(a.id)}
                  className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium text-destructive cursor-pointer hover:bg-ink/5"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}

        {canEdit && showForm && (
          <div className="rounded-md ring-1 ring-line p-3 space-y-3">
            <p className="label-mono">{editingId ? "Edit asset" : "Issue an asset"}</p>
            <div className={`grid gap-3 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
              <Select
                label="Category"
                value={draft.category}
                onChange={(v) => setDraft({ ...draft, category: v as AssetCategory })}
                options={Object.entries(ASSET_CATEGORY_LABEL).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <Combo
                label="Item type"
                value={draft.asset_type}
                onChange={(v) => setDraft({ ...draft, asset_type: v })}
                options={ASSET_TYPE_SUGGESTIONS}
              />
              <Input
                label="Item name"
                value={draft.name}
                onChange={(v) => setDraft({ ...draft, name: v })}
              />
              <Input
                label="Make and model"
                value={draft.make_model}
                onChange={(v) => setDraft({ ...draft, make_model: v })}
              />
              <Input
                label="Serial number"
                value={draft.serial_number}
                onChange={(v) => setDraft({ ...draft, serial_number: v })}
              />
              <Input
                label="Asset tag"
                value={draft.asset_tag}
                onChange={(v) => setDraft({ ...draft, asset_tag: v })}
              />
              <Input
                label="Vendor"
                value={draft.vendor}
                onChange={(v) => setDraft({ ...draft, vendor: v })}
              />
              <Input
                label="Licence key / account"
                value={draft.license_key}
                onChange={(v) => setDraft({ ...draft, license_key: v })}
              />
              <Input
                label="Quantity"
                type="number"
                value={draft.quantity}
                onChange={(v) => setDraft({ ...draft, quantity: v })}
              />
              <Input
                label="Issued on"
                type="date"
                value={draft.assigned_on}
                onChange={(v) => setDraft({ ...draft, assigned_on: v })}
              />
              <Input
                label="Return due"
                type="date"
                value={draft.return_due}
                onChange={(v) => setDraft({ ...draft, return_due: v })}
              />
              <Input
                label="Renewal date"
                type="date"
                value={draft.renewal_date}
                onChange={(v) => setDraft({ ...draft, renewal_date: v })}
              />
              <Input
                label="Cost"
                type="number"
                value={draft.cost}
                onChange={(v) => setDraft({ ...draft, cost: v })}
              />
              <Input
                label="Currency"
                value={draft.currency}
                onChange={(v) => setDraft({ ...draft, currency: v })}
              />
              <Select
                label="Status"
                value={draft.status}
                onChange={(v) => setDraft({ ...draft, status: v as AssetState })}
                options={Object.entries(ASSET_STATE_LABEL).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <Input
                label="Notes"
                value={draft.notes}
                onChange={(v) => setDraft({ ...draft, notes: v })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
              >
                {save.isPending ? "Saving…" : editingId ? "Save asset" : "Add asset"}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setEditingId("");
                  setDraft(emptyDraft());
                }}
                className="h-9 px-4 rounded-md ring-1 ring-line text-[13px] font-medium cursor-pointer hover:bg-ink/5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {canEdit && (
          <p className="text-[12px] text-ink-soft">
            Loading many at once? Use the Assets sheet on the Import &amp; export page.
          </p>
        )}
      </div>
    </Panel>
  );
}
