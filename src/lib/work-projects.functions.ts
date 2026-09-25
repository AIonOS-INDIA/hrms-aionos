import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WorkProject = { id: string; account: string; name: string };

// Enterprise Management backend (public, publishable values only).
const EM_URL = "https://puctyrrcrmzbicupkidr.supabase.co";
const EM_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3R5cnJjcm16YmljdXBraWRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjM1NDcsImV4cCI6MjA5MTU5OTU0N30.xHsmTL0VCHCJo-kd6nBaToizbYTChiegyoLDj6Xg7X4";

/** Accounts and their projects from Enterprise Management, for the timesheet Project picker. */
export const listWorkProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ projects: WorkProject[]; error: string | null }> => {
    const key = process.env["EM_PROJECTS_KEY"];
    if (!key) return { projects: [], error: "Project list is not connected yet" };
    try {
      const res = await fetch(`${EM_URL}/rest/v1/rpc/hrms_project_list`, {
        method: "POST",
        headers: {
          apikey: EM_ANON,
          Authorization: `Bearer ${EM_ANON}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ _key: key }),
      });
      if (!res.ok) {
        console.error("hrms_project_list failed", res.status, await res.text());
        return { projects: [], error: "Could not reach Enterprise Management" };
      }
      const rows = (await res.json()) as { project_id: string; account_name: string; project_name: string }[];
      return {
        projects: rows
          .map((r) => ({ id: r.project_id, account: r.account_name ?? "", name: r.project_name ?? "" }))
          .filter((p) => p.name)
          .sort((a, b) => a.account.localeCompare(b.account) || a.name.localeCompare(b.name)),
        error: null,
      };
    } catch (e) {
      console.error(e);
      return { projects: [], error: "Could not reach Enterprise Management" };
    }
  });

export const projectLabel = (p: Pick<WorkProject, "account" | "name">) =>
  p.account ? `${p.account} · ${p.name}` : p.name;
