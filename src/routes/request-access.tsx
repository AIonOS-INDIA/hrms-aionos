import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/request-access")({
  head: () => ({
    meta: [
      { title: "Request subsidiary access — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "New AIONOS group subsidiaries request their own HR workspace: submit your company, work email domain and HR contact for Master HR approval.",
      },
      { property: "og:title", content: "Request subsidiary access — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content:
          "Submit your subsidiary and HR details. AIONOS Master HR approves and your company and login are created.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RequestAccess,
});

const domainOf = (email: string) => email.split("@")[1]?.trim().toLowerCase() ?? "";

function RequestAccess() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const domain = domainOf(email);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!domain) throw new Error("Enter your full work email");
      const { error } = await supabase.from("subsidiary_requests").insert({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        company_name: companyName.trim(),
        company_code: (companyCode.trim() || companyName.trim().slice(0, 4)).toUpperCase(),
        email_domain: domain,
        note: note.trim(),
      });
      if (error) throw new Error(error.message);
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send your request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <Link to="/" className="label-mono hover:text-ink">
          ← Back to sign in
        </Link>

        {done ? (
          <div className="mt-6 rounded-[14px] ring-1 ring-line bg-panel p-6">
            <p className="label-mono">Request received</p>
            <h1 className="text-[26px] font-semibold tracking-tight mt-1">
              Waiting on AIONOS Master HR
            </h1>
            <p className="text-[13px] text-ink-soft mt-2">
              Once approved, {companyName || "your company"} is added as a group entity with the{" "}
              <span className="font-mono">@{domain}</span> email domain and your HR login is created
              for {email}. Master HR will share your first password with you.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6">
            <p className="label-mono">Subsidiary onboarding</p>
            <h1 className="text-[28px] font-semibold tracking-tight mt-1">
              Bring your company into the group HRMS
            </h1>
            <p className="text-[13px] text-ink-soft mt-1">
              Tell us who you are and which subsidiary you run HR for. AIONOS Master HR reviews the
              request, then your entity, email domain and HR account are created automatically.
            </p>

            <div className="mt-6 space-y-3">
              <Field label="Your full name" value={fullName} onChange={setFullName} required />
              <Field
                label="Work email"
                value={email}
                onChange={setEmail}
                type="email"
                mono
                required
                placeholder="you@yourcompany.com"
              />
              {domain && (
                <p className="label-mono">
                  Your subsidiary domain will be @{domain}
                </p>
              )}
              <Field
                label="Subsidiary name"
                value={companyName}
                onChange={setCompanyName}
                required
              />
              <Field
                label="Short code (optional)"
                value={companyCode}
                onChange={(v) => setCompanyCode(v.toUpperCase().replace(/\s+/g, ""))}
              />
              <div>
                <p className="label-mono mb-1">Anything Master HR should know (optional)</p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-md bg-panel ring-1 ring-line text-[14px] outline-none focus:ring-ink"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="mt-5 w-full h-11 rounded-md bg-brand text-paper text-[14px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send request"}
            </button>
            <p className="text-[12px] text-ink-soft mt-3">
              Once approved, your company workspace and HR login are created automatically.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean | undefined;
  mono?: boolean | undefined;
  placeholder?: string | undefined;
}) {
  return (
    <div>
      <p className="label-mono mb-1">{label}</p>
      <input
        type={type}
        value={value}
        required={required ?? false}
        placeholder={placeholder ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full h-11 px-3 rounded-md bg-panel ring-1 ring-line text-[14px] outline-none focus:ring-ink ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
