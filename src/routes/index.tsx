import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sendPasswordReset } from "@/lib/password-reset.functions";
import aionosMark from "@/assets/aionos-mark.png";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "AIONOS HR Control Tower — Group HRMS" },
      {
        name: "description",
        content:
          "One HR system for AIONOS, Perpetuuiti, Whilter and Cloud Analogy: onboarding, leave, timesheets and group policies.",
      },
      { property: "og:title", content: "AIONOS HR Control Tower — Group HRMS" },
      {
        property: "og:description",
        content:
          "Sign in to manage people, leave and timesheets across every AIONOS group company.",
      },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      if (!data.session) throw new Error("Sign in succeeded but no session was created");
      await navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-[1.1fr_minmax(0,470px)]">
      <section className="relative hidden lg:flex flex-col justify-between overflow-hidden p-10 text-paper bg-[linear-gradient(140deg,var(--color-brand-deep)_0%,var(--color-ink)_45%,var(--color-brand)_130%)]">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-24 size-[420px] rounded-full bg-brand/35 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 size-[380px] rounded-full bg-volt/20 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <div className="size-11 rounded-xl bg-paper/95 grid place-items-center p-1.5 shadow-lg shadow-black/20">
            <img src={aionosMark} alt="AIONOS logo" className="size-full object-contain" />
          </div>
          <div>
            <p className="text-[14px] font-semibold leading-tight tracking-tight">AIONOS</p>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-paper/60">
              HR Control Tower
            </p>
          </div>
        </div>

        <div className="relative max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-paper/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.16em] text-paper/80 ring-1 ring-paper/15">
            <span className="size-1.5 rounded-full bg-volt blink" />
            One group · one mission
          </p>
          <h1 className="mt-5 text-[46px] leading-[1.03] font-semibold tracking-tight">
            One team.
            <br />
            <span className="bg-[linear-gradient(90deg,var(--color-volt),var(--color-brand-soft))] bg-clip-text text-transparent">
              One mission.
            </span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-paper/75">
            Every person across AIONOS and its companies works from the same playbook — shared
            policies, shared calendars, shared goals — while each team runs its own day to day.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-2.5">
            {[
              { name: "AIONOS", dot: "bg-brand" },
              { name: "Perpetuuiti", dot: "bg-perp" },
              { name: "Whilter", dot: "bg-whilter" },
              { name: "Cloud Analogy", dot: "bg-cloud" },
              { name: "Inetum", dot: "bg-inetum" },
            ].map((c) => (
              <div
                key={c.name}
                className="rounded-xl bg-paper/8 px-4 py-3 ring-1 ring-paper/12 backdrop-blur-sm"
              >
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${c.dot}`} />
                  <p className="text-[13px] font-medium">{c.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[11px] font-mono text-paper/50">
          Sign in with your company email · access follows your HR record
        </p>
      </section>

      <section className="flex items-center justify-center p-6 bg-[radial-gradient(120%_90%_at_100%_0%,var(--color-brand-soft)_0%,var(--color-paper)_55%)]">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="lg:hidden mb-6 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-paper grid place-items-center p-1.5 ring-1 ring-line">
              <img src={aionosMark} alt="AIONOS logo" className="size-full object-contain" />
            </div>
            <div>
              <p className="text-[14px] font-semibold leading-tight">AIONOS</p>
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-ink-soft">
                HR Control Tower
              </p>
            </div>
          </div>
          <p className="label-mono">Sign in</p>
          <h2 className="text-[26px] font-semibold tracking-tight mt-1">Welcome back</h2>
          <p className="text-[13px] text-ink-soft mt-1">
            Use the work email your HR team onboarded you with.
          </p>

          <div className="mt-6 space-y-3">
            <div>
              <p className="label-mono mb-1">Work email</p>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@aionos.co"
                className="w-full h-11 px-3 rounded-md bg-panel ring-1 ring-line text-[14px] font-mono outline-none focus:ring-ink"
              />
            </div>
            <div>
              <p className="label-mono mb-1">Password</p>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 px-3 rounded-md bg-panel ring-1 ring-line text-[14px] outline-none focus:ring-ink"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full h-11 rounded-lg bg-[linear-gradient(100deg,var(--color-brand-deep),var(--color-brand))] text-paper text-[14px] font-semibold cursor-pointer shadow-md shadow-brand/25 transition hover:opacity-95 disabled:opacity-50"
          >
            {busy ? "Working…" : "Sign in"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!email.trim()) {
                toast.error("Enter your work email first");
                return;
              }
              setBusy(true);
              try {
                const res = await sendPasswordReset({
                  data: {
                    email: email.trim(),
                  },
                });
                if (res.sent) toast.success("Password reset link sent to your work email");
                else toast.error("No account found for that work email");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not send reset link");
              } finally {
                setBusy(false);
              }
            }}
            className="mt-3 w-full h-10 rounded-md text-[13px] font-medium cursor-pointer text-ink-soft hover:bg-ink/5 disabled:opacity-50"
          >
            Forgot password?
          </button>
        </form>
      </section>
    </main>
  );
}
