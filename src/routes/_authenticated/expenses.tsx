import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AppShell,
  EntityTag,
  FilterNote,
  Panel,
  StatCard,
  StatusPill,
  useScope,
} from "@/components/AppShell";
import {
  EXPENSE_CATEGORIES,
  fmtDate,
  money,
  receiptUrl,
  useEmployees,
  useExpenseClaims,
  useExpenseReceipts,
  useMe,
  type ExpenseClaim,
  type ExpenseReceipt,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Submit business trip expenses with receipts and let finance review, approve and reimburse them.",
      },
      { property: "og:title", content: "Expenses — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Trip expenses, receipt uploads, finance review and reimbursement.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpensesPage,
});

function ExpensesPage() {
  return (
    <AppShell title="Expenses" subtitle="Business trips · receipts · reimbursement">
      <ExpensesBody />
    </AppShell>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function ExpensesBody() {
  const { data: me } = useMe();
  const { companyId, companyById } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: claims = [] } = useExpenseClaims();
  const { data: receipts = [] } = useExpenseReceipts();
  const queryClient = useQueryClient();

  const canReview = !!me?.isMaster || !!me?.hrCompanyId || !!me?.isExpenseApprover;
  const reviewCompanyIds = me?.isMaster
    ? null
    : [...(me?.hrCompanyIds ?? []), ...(me?.expenseCompanyIds ?? [])];
  const myId = me?.employee?.id;

  const [tile, setTile] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: "",
    destination: "",
    purpose: "",
    trip_start: today(),
    trip_end: today(),
  });

  const peopleById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["expense_claims"] });
    void queryClient.invalidateQueries({ queryKey: ["expense_receipts"] });
  };

  const myClaims = claims.filter((c) => c.employee_id === myId);
  const teamClaims = useMemo(
    () =>
      canReview
        ? claims.filter(
            (c) =>
              (companyId ? c.company_id === companyId : true) &&
              (!reviewCompanyIds || reviewCompanyIds.includes(c.company_id)) &&
              c.status !== "draft",
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [claims, companyId, canReview, me?.isMaster, me?.hrCompanyIds, me?.expenseCompanyIds],
  );

  const receiptsFor = (claimId: string) => receipts.filter((r) => r.claim_id === claimId);

  const create = useMutation({
    mutationFn: async () => {
      if (!myId || !me?.employee) throw new Error("Your employee record is not linked yet");
      if (!form.title.trim()) throw new Error("Give the trip a name");
      const { data, error } = await supabase
        .from("expense_claims")
        .insert({
          employee_id: myId,
          company_id: me.employee.company_id,
          title: form.title.trim(),
          destination: form.destination.trim(),
          purpose: form.purpose.trim(),
          trip_start: form.trip_start,
          trip_end: form.trip_end,
          status: "draft",
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as ExpenseClaim;
    },
    onSuccess: (claim) => {
      toast.success("Trip created — add your receipts");
      setCreating(false);
      setForm({ title: "", destination: "", purpose: "", trip_start: today(), trip_end: today() });
      setOpenId(claim.id);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = useMutation({
    mutationFn: async (claim: ExpenseClaim) => {
      const items = receiptsFor(claim.id);
      if (!items.length) throw new Error("Attach at least one receipt first");
      const total = items.reduce((sum, r) => sum + Number(r.amount || 0), 0);
      if (total <= 0) throw new Error("Add the amount on your receipts");
      const { error } = await supabase
        .from("expense_claims")
        .update({ status: "submitted", submitted_at: new Date().toISOString(), total_amount: total })
        .eq("id", claim.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sent to finance for review");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: async (opts: { claim: ExpenseClaim; status: "approved" | "rejected"; note: string }) => {
      const { error } = await supabase
        .from("expense_claims")
        .update({
          status: opts.status,
          finance_note: opts.note,
          finance_decided_at: new Date().toISOString(),
        })
        .eq("id", opts.claim.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Decision saved");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reimburse = useMutation({
    mutationFn: async (opts: {
      claim: ExpenseClaim;
      paid_on: string;
      amount: number;
      reference: string;
    }) => {
      if (!(opts.amount > 0)) throw new Error("Add the amount released");
      const { error } = await supabase
        .from("expense_claims")
        .update({
          status: "reimbursed",
          reimbursed_on: opts.paid_on,
          reimbursed_amount: opts.amount,
          payment_reference: opts.reference,
        })
        .eq("id", opts.claim.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reimbursement recorded");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = teamClaims.filter((c) => c.status === "submitted");
  const approved = teamClaims.filter((c) => c.status === "approved");
  const paid = teamClaims.filter((c) => c.status === "reimbursed");
  const released = paid.reduce((s, c) => s + Number(c.reimbursed_amount || 0), 0);

  const shownTeam =
    tile === "pending"
      ? pending
      : tile === "approved"
        ? approved
        : tile === "paid"
          ? paid
          : teamClaims;

  return (
    <div className="space-y-4">
      {canReview && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Waiting on review"
              value={pending.length}
              hint="Submitted claims"
              hintTone="warn"
              onClick={() => setTile(tile === "pending" ? null : "pending")}
              active={tile === "pending"}
            />
            <StatCard
              label="Approved to pay"
              value={approved.length}
              hint="Ready for release"
              onClick={() => setTile(tile === "approved" ? null : "approved")}
              active={tile === "approved"}
            />
            <StatCard
              label="Reimbursed"
              value={paid.length}
              hint="Money released"
              hintTone="good"
              onClick={() => setTile(tile === "paid" ? null : "paid")}
              active={tile === "paid"}
            />
            <StatCard
              label="Total released"
              value={money(released)}
              hint="Across shown claims"
              onClick={() => setTile(tile === "paid" ? null : "paid")}
              active={tile === "paid"}
            />
          </div>
          {tile && <FilterNote label={tile} count={shownTeam.length} onClear={() => setTile(null)} />}

          <Panel
            title="Claims to review"
            meta={<span className="label-mono">{shownTeam.length} claims</span>}
          >
            <div className="divide-y divide-line">
              {shownTeam.map((claim) => (
                <ReviewRow
                  key={claim.id}
                  claim={claim}
                  who={peopleById.get(claim.employee_id)?.full_name ?? "—"}
                  entity={companyById(claim.company_id)}
                  receipts={receiptsFor(claim.id)}
                  onDecide={(status, note) => decide.mutate({ claim, status, note })}
                  onReimburse={(paid_on, amount, reference) =>
                    reimburse.mutate({ claim, paid_on, amount, reference })
                  }
                />
              ))}
              {!shownTeam.length && (
                <p className="px-4 py-8 text-center text-ink-soft text-[13px]">
                  Nothing here right now.
                </p>
              )}
            </div>
          </Panel>
        </>
      )}

      <Panel
        title="My trips"
        meta={
          <button
            onClick={() => setCreating((v) => !v)}
            className="h-8 px-3 rounded-lg bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
          >
            {creating ? "Close" : "New trip"}
          </button>
        }
      >
        {creating && (
          <div className="px-4 py-3 border-b border-line grid gap-2 sm:grid-cols-2">
            <Field label="Trip name">
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Client visit — Dubai"
                className={inputCls}
              />
            </Field>
            <Field label="Destination">
              <input
                value={form.destination}
                onChange={(e) => setForm({ ...form, destination: e.target.value })}
                placeholder="Dubai, UAE"
                className={inputCls}
              />
            </Field>
            <Field label="From">
              <input
                type="date"
                value={form.trip_start}
                onChange={(e) => setForm({ ...form, trip_start: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                value={form.trip_end}
                onChange={(e) => setForm({ ...form, trip_end: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Business purpose" wide>
              <input
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="Quarterly review with the client team"
                className={inputCls}
              />
            </Field>
            <div className="sm:col-span-2">
              <button
                onClick={() => create.mutate()}
                disabled={create.isPending}
                className="h-9 px-4 rounded-lg bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-60"
              >
                Create trip
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-line">
          {myClaims.map((claim) => (
            <MyClaimRow
              key={claim.id}
              claim={claim}
              open={openId === claim.id}
              onToggle={() => setOpenId(openId === claim.id ? null : claim.id)}
              receipts={receiptsFor(claim.id)}
              employeeId={myId ?? ""}
              onChanged={refresh}
              onSubmit={() => submit.mutate(claim)}
            />
          ))}
          {!myClaims.length && !creating && (
            <p className="px-4 py-8 text-center text-ink-soft text-[13px]">
              No trips yet. Choose New trip, then add your receipts.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}

const inputCls =
  "w-full h-9 px-3 rounded-lg bg-paper ring-1 ring-line text-[13px] outline-none focus:ring-brand";

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="label-mono">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ReceiptList({ items }: { items: ExpenseReceipt[] }) {
  const open = async (path: string) => {
    try {
      const url = await receiptUrl(path);
      window.open(url, "_blank", "noopener");
    } catch {
      toast.error("That receipt could not be opened");
    }
  };
  if (!items.length)
    return <p className="text-[12px] text-ink-soft">No receipts attached yet.</p>;
  return (
    <ul className="space-y-1">
      {items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="font-medium">{r.category}</span>
          <span className="font-mono text-ink-soft">{money(Number(r.amount))}</span>
          {r.merchant && <span className="text-ink-soft truncate">{r.merchant}</span>}
          {r.spent_on && <span className="font-mono text-[11px] text-ink-soft">{r.spent_on}</span>}
          {r.file_path && (
            <button
              onClick={() => open(r.file_path)}
              className="text-[11px] font-mono text-brand underline cursor-pointer"
            >
              view receipt
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function MyClaimRow({
  claim,
  open,
  onToggle,
  receipts,
  employeeId,
  onChanged,
  onSubmit,
}: {
  claim: ExpenseClaim;
  open: boolean;
  onToggle: () => void;
  receipts: ExpenseReceipt[];
  employeeId: string;
  onChanged: () => void;
  onSubmit: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState({
    category: EXPENSE_CATEGORIES[0] as string,
    amount: "",
    merchant: "",
    spent_on: today(),
  });

  const editable = claim.status === "draft" || claim.status === "rejected";
  const total = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);

  const addReceipt = async (file: File | null) => {
    if (!(Number(item.amount) > 0)) {
      toast.error("Enter the amount on the receipt");
      return;
    }
    setBusy(true);
    try {
      let filePath = "";
      let fileName = "";
      let fileType = "";
      if (file) {
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        filePath = `${employeeId}/${claim.id}/${Date.now()}-${safe}`;
        const { error } = await supabase.storage
          .from("expense-receipts")
          .upload(filePath, file, { upsert: false });
        if (error) throw error;
        fileName = file.name;
        fileType = file.type;
      }
      const { error } = await supabase.from("expense_receipts").insert({
        claim_id: claim.id,
        category: item.category,
        amount: Number(item.amount),
        merchant: item.merchant,
        spent_on: item.spent_on,
        file_path: filePath,
        file_name: fileName,
        file_type: fileType,
      });
      if (error) throw error;
      setItem({ category: item.category, amount: "", merchant: "", spent_on: item.spent_on });
      toast.success("Receipt added");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add that receipt");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  };

  return (
    <div className="px-4 py-3 space-y-2">
      <button onClick={onToggle} className="w-full text-left cursor-pointer">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium truncate">{claim.title || "Untitled trip"}</p>
            <p className="text-[11px] font-mono text-ink-soft truncate">
              {claim.destination || "—"} ·{" "}
              {claim.trip_start ? fmtDate(claim.trip_start) : "—"}
              {claim.trip_end ? ` → ${fmtDate(claim.trip_end)}` : ""}
            </p>
          </div>
          <span className="font-mono text-[12px] font-semibold">
            {money(total || Number(claim.total_amount), claim.currency)}
          </span>
          <StatusPill status={claim.status} />
        </div>
      </button>

      {open && (
        <div className="space-y-3 pt-1">
          <ReceiptList items={receipts} />

          {editable && (
            <div className="rounded-xl ring-1 ring-line p-3 space-y-2 bg-paper">
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                <select
                  value={item.category}
                  onChange={(e) => setItem({ ...item, category: e.target.value })}
                  className={inputCls}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="decimal"
                  value={item.amount}
                  onChange={(e) => setItem({ ...item, amount: e.target.value })}
                  placeholder="Amount"
                  className={inputCls}
                />
                <input
                  value={item.merchant}
                  onChange={(e) => setItem({ ...item, merchant: e.target.value })}
                  placeholder="Paid to"
                  className={inputCls}
                />
                <input
                  type="date"
                  value={item.spent_on}
                  onChange={(e) => setItem({ ...item, spent_on: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => void addReceipt(e.target.files?.[0] ?? null)}
                />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => void addReceipt(e.target.files?.[0] ?? null)}
                />
                <button
                  disabled={busy}
                  onClick={() => cameraRef.current?.click()}
                  className="h-9 px-3 rounded-lg bg-brand text-paper text-[12.5px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-60"
                >
                  Take a photo
                </button>
                <button
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                  className="h-9 px-3 rounded-lg ring-1 ring-line text-[12.5px] font-medium cursor-pointer hover:bg-ink/5 disabled:opacity-60"
                >
                  Upload a file
                </button>
                <button
                  disabled={busy}
                  onClick={() => void addReceipt(null)}
                  className="h-9 px-3 rounded-lg ring-1 ring-line text-[12.5px] font-medium cursor-pointer hover:bg-ink/5 disabled:opacity-60"
                >
                  Add amount only
                </button>
              </div>
            </div>
          )}

          {claim.finance_note && (
            <p className="text-[12px] text-ink-soft">
              <b className="text-ink">Finance:</b> {claim.finance_note}
            </p>
          )}
          {claim.status === "reimbursed" && (
            <p className="text-[12px] text-ink-soft font-mono">
              Paid {money(Number(claim.reimbursed_amount), claim.currency)} on{" "}
              {claim.reimbursed_on ?? "—"} · {claim.payment_reference || "no reference"}
            </p>
          )}

          {editable && (
            <button
              onClick={onSubmit}
              className="h-9 px-4 rounded-lg bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep"
            >
              Send to finance
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewRow({
  claim,
  who,
  entity,
  receipts,
  onDecide,
  onReimburse,
}: {
  claim: ExpenseClaim;
  who: string;
  entity: ReturnType<ReturnType<typeof useScope>["companyById"]>;
  receipts: ExpenseReceipt[];
  onDecide: (status: "approved" | "rejected", note: string) => void;
  onReimburse: (paidOn: string, amount: number, reference: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pay, setPay] = useState({
    paid_on: today(),
    amount: String(Number(claim.total_amount) || ""),
    reference: "",
  });

  return (
    <div className="px-4 py-3 space-y-2">
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left cursor-pointer">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium truncate">{who}</p>
            <p className="text-[11px] font-mono text-ink-soft truncate">
              {claim.title} · {claim.destination || "—"}
            </p>
          </div>
          {entity && <EntityTag company={entity} />}
          <span className="font-mono text-[12px] font-semibold">
            {money(Number(claim.total_amount), claim.currency)}
          </span>
          <StatusPill status={claim.status} />
        </div>
      </button>

      {open && (
        <div className="space-y-3 pt-1">
          <p className="text-[12.5px] text-ink-soft">{claim.purpose || "No purpose given"}</p>
          <ReceiptList items={receipts} />

          {claim.status === "submitted" && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note for the employee"
                className="h-9 flex-1 min-w-[10rem] px-3 rounded-lg bg-paper ring-1 ring-line text-[12.5px] outline-none focus:ring-brand"
              />
              <button
                onClick={() => onDecide("approved", note)}
                className="h-9 px-3 rounded-lg bg-brand text-paper text-[12.5px] font-semibold cursor-pointer hover:bg-brand-deep"
              >
                Approve
              </button>
              <button
                onClick={() => onDecide("rejected", note)}
                className="h-9 px-3 rounded-lg ring-1 ring-line text-[12.5px] font-medium cursor-pointer hover:bg-ink/5"
              >
                Send back
              </button>
            </div>
          )}

          {claim.status === "approved" && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="label-mono">
                Paid on
                <input
                  type="date"
                  value={pay.paid_on}
                  onChange={(e) => setPay({ ...pay, paid_on: e.target.value })}
                  className="block h-9 px-2 rounded-lg bg-paper ring-1 ring-line text-[12.5px] outline-none focus:ring-brand"
                />
              </label>
              <label className="label-mono">
                Amount
                <input
                  type="number"
                  value={pay.amount}
                  onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                  className="block h-9 w-28 px-2 rounded-lg bg-paper ring-1 ring-line text-[12.5px] outline-none focus:ring-brand"
                />
              </label>
              <label className="label-mono">
                Reference
                <input
                  value={pay.reference}
                  onChange={(e) => setPay({ ...pay, reference: e.target.value })}
                  placeholder="UTR / transfer id"
                  className="block h-9 w-40 px-2 rounded-lg bg-paper ring-1 ring-line text-[12.5px] outline-none focus:ring-brand"
                />
              </label>
              <button
                onClick={() => onReimburse(pay.paid_on, Number(pay.amount), pay.reference)}
                className="h-9 px-3 rounded-lg bg-brand text-paper text-[12.5px] font-semibold cursor-pointer hover:bg-brand-deep"
              >
                Release reimbursement
              </button>
            </div>
          )}

          {claim.status === "reimbursed" && (
            <p className="text-[12px] font-mono text-ink-soft">
              Paid {money(Number(claim.reimbursed_amount), claim.currency)} on{" "}
              {claim.reimbursed_on ?? "—"} · {claim.payment_reference || "no reference"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
