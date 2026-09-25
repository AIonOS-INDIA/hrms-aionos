import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell, useScope } from "@/components/AppShell";
import { useEmployees, useMe, useMyOrg } from "@/lib/hrms";
import { MyAttendance } from "@/components/attendance/MyAttendance";
import { TeamAttendance } from "@/components/attendance/TeamAttendance";
import { AttendanceSettings } from "@/components/attendance/AttendanceSettings";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — AIONOS HR Control Tower" },
      { name: "description", content: "Punch in with face and location check, shifts, rosters, overtime, comp-offs and team attendance." },
      { property: "og:title", content: "Attendance — AIONOS HR Control Tower" },
      { property: "og:description", content: "Punches, shifts, overtime, comp-offs and team attendance in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell title="Attendance" subtitle="Punch, shifts, overtime and team view">
      <Body />
    </AppShell>
  ),
});

function Body() {
  const { data: me } = useMe();
  const { data: org } = useMyOrg();
  const { companyId: scopeCompany } = useScope();
  const isHr = !!me?.isMaster || (me?.hrCompanyIds?.length ?? 0) > 0;
  const { data: employees = [] } = useEmployees();
  const companyId = scopeCompany || me?.hrCompanyIds?.[0] || me?.employee?.company_id || "";
  const hasTeam = (org?.flat.length ?? 0) > 0;
  const [view, setView] = useState<"me" | "team" | "setup">("me");

  const members = useMemo(() => {
    if (hasTeam) return org!.flat.map((n) => ({ person: n.person, depth: n.depth }));
    if (isHr) return employees.filter((e) => e.company_id === companyId && e.status !== "offboarded").map((p) => ({ person: p, depth: 1 }));
    return [];
  }, [hasTeam, org, isHr, employees, companyId]);

  if (!me?.employee && !isHr) return <p className="text-[13px] text-ink-soft">Your employee record isn't linked yet.</p>;

  const tabs = [
    me?.employee && { id: "me", label: "My attendance" },
    (hasTeam || isHr) && { id: "team", label: hasTeam ? "My team" : "Company team" },
    isHr && { id: "setup", label: "Rules & setup" },
  ].filter(Boolean) as { id: typeof view; label: string }[];
  const active = tabs.find((t) => t.id === view) ? view : tabs[0]?.id;

  return (
    <div className="space-y-4">
      {tabs.length > 1 && (
        <div className="inline-flex rounded-xl bg-panel ring-1 ring-line p-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setView(t.id)} className={`h-9 px-4 rounded-lg text-[13px] font-medium cursor-pointer ${active === t.id ? "bg-brand text-paper" : "hover:bg-ink/5"}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {active === "me" && me?.employee && <MyAttendance employeeId={me.employee.id} companyId={me.employee.company_id} />}
      {active === "team" && <TeamAttendance members={members} companyId={companyId} isHr={isHr} myId={me?.employee?.id ?? ""} />}
      {active === "setup" && <AttendanceSettings companyId={companyId} employees={employees} />}
    </div>
  );
}
