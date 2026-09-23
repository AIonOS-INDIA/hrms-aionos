import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Panel } from "@/components/AppShell";
import { ChannelPanel } from "@/components/ChannelPanel";
import { Input } from "@/routes/_authenticated/employees";
import { fmtDate, reportingChain, useCompanies, useEmployees, useMe } from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "My record — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "View your employee record, update your phone number and home address, and change your password.",
      },
      { property: "og:title", content: "My record — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Your employment details, contact information and password settings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <AppShell title="My record" subtitle="Your details · contact information · password">
      <ProfileBody />
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label-mono">{label}</p>
      <p className="text-[13px] mt-0.5">{value || "—"}</p>
    </div>
  );
}

function ProfileBody() {
  const { data: me } = useMe();
  const { data: companies = [] } = useCompanies();
  const { data: employees = [] } = useEmployees();
  const queryClient = useQueryClient();

  const emp = me?.employee ?? null;
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [current, setCurrent] = useState("");

  useEffect(() => {
    setPhone(emp?.phone ?? "");
    setAddress(emp?.home_address ?? "");
  }, [emp?.id, emp?.phone, emp?.home_address]);

  const saveContact = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("update_my_contact", {
        _phone: phone.trim(),
        _home_address: address.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contact details saved");
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      if (password.length < 8) throw new Error("Use at least 8 characters");
      const { error } = await supabase.auth.updateUser({
        password,
        ...(current ? { current_password: current } : {}),
      } as Parameters<typeof supabase.auth.updateUser>[0]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password updated");
      setPassword("");
      setCurrent("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const emailReset = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(me?.email ?? "", {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Reset link sent to your work email"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!emp) {
    return (
      <Panel title="My record">
        <p className="p-4 text-[13px] text-ink-soft">
          We could not find an employee record for {me?.email}. Ask your HR team to add your work
          email to the people list, then sign in again.
        </p>
      </Panel>
    );
  }

  const company = companies.find((c) => c.id === emp.company_id);
  const chain = reportingChain(employees, emp.id);
  const manager = chain[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] items-start">
      <Panel title="Employment details">
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Row label="Employee ID" value={emp.employee_code ?? ""} />
          <Row label="Full name" value={emp.full_name} />
          <Row label="Work email" value={emp.email} />
          <Row label="Company" value={company?.name ?? ""} />
          <Row label="Designation" value={emp.job_title} />
          <Row label="Band" value={emp.band ?? ""} />
          <Row label="Department" value={emp.department} />
          <Row label="Business unit" value={emp.business_unit ?? ""} />
          <Row label="Employment type" value={(emp.employment_type ?? "").replace("_", " ")} />
          <Row label="Employment status" value={emp.status.replace("_", " ")} />
          <Row label="Gender" value={emp.gender ?? ""} />
          <Row label="Date of birth" value={emp.date_of_birth ? fmtDate(emp.date_of_birth) : ""} />
          <Row label="Office location" value={emp.location} />
          <Row label="Office city" value={emp.office_city ?? ""} />
          <Row label="Current office area" value={emp.office_area ?? ""} />
          <Row label="Legal entity" value={emp.legal_entity ?? ""} />
          <Row label="Date of joining" value={fmtDate(emp.joined_on)} />
          <Row label="Date of exit" value={emp.exit_on ? fmtDate(emp.exit_on) : ""} />
          <Row label="Manager" value={manager ? `${manager.full_name} · ${manager.job_title}` : ""} />
          <Row
            label="Reporting ladder"
            value={chain.map((m) => m.full_name).join(" → ")}
          />
        </div>
      </Panel>

      <div className="grid gap-4">
        <Panel title="Contact details">
          <div className="p-4 space-y-3">
            <Input label="Phone number" value={phone} onChange={setPhone} />
            <Input label="Home address" value={address} onChange={setAddress} />
            <button
              disabled={saveContact.isPending}
              onClick={() => saveContact.mutate()}
              className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
            >
              {saveContact.isPending ? "Saving…" : "Save contact details"}
            </button>
          </div>
        </Panel>

        <Panel title="Password">
          <div className="p-4 space-y-3">
            <Input label="Current password" type="password" value={current} onChange={setCurrent} />
            <Input label="New password" type="password" value={password} onChange={setPassword} />
            <div className="flex flex-wrap gap-2">
              <button
                disabled={changePassword.isPending}
                onClick={() => changePassword.mutate()}
                className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
              >
                {changePassword.isPending ? "Updating…" : "Update password"}
              </button>
              <button
                disabled={emailReset.isPending}
                onClick={() => emailReset.mutate()}
                className="h-9 px-4 rounded-md ring-1 ring-line text-[13px] font-medium cursor-pointer hover:bg-ink/5 disabled:opacity-50"
              >
                Email me a reset link
              </button>
            </div>
          </div>
        </Panel>

        <ChannelPanel />
      </div>
    </div>
  );
}
