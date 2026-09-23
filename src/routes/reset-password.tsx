import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import aionosMark from "@/assets/aionos-mark.png";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password — AIONOS HR" },
      { name: "description", content: "Choose a new password for your AIONOS HR account." },
      { property: "og:title", content: "Set a new password — AIONOS HR" },
      {
        property: "og:description",
        content: "Choose a new password for your AIONOS HR account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Both passwords must match");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-[radial-gradient(120%_90%_at_100%_0%,var(--color-brand-soft)_0%,var(--color-paper)_55%)]">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="size-10 rounded-xl bg-paper grid place-items-center p-1.5 ring-1 ring-line">
            <img src={aionosMark} alt="AIONOS logo" className="size-full object-contain" />
          </div>
          <p className="text-[14px] font-semibold">AIONOS HR</p>
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight">Set a new password</h1>
        <p className="text-[13px] text-ink-soft mt-1">
          {ready
            ? "Choose a password you will remember."
            : "Open this page from the link in your email to continue."}
        </p>
        <div className="mt-5 space-y-3">
          <div>
            <p className="label-mono mb-1">New password</p>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-3 rounded-md bg-panel ring-1 ring-line text-[14px] outline-none focus:ring-ink"
            />
          </div>
          <div>
            <p className="label-mono mb-1">Confirm password</p>
            <input
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full h-11 px-3 rounded-md bg-panel ring-1 ring-line text-[14px] outline-none focus:ring-ink"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={busy || !ready}
          className="mt-5 w-full h-11 rounded-lg bg-[linear-gradient(100deg,var(--color-brand-deep),var(--color-brand))] text-paper text-[14px] font-semibold cursor-pointer disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </main>
  );
}
