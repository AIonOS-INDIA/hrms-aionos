import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listWorkProjects, projectLabel } from "@/lib/work-projects.functions";
import { ProjectPicker } from "@/components/ProjectPicker";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  Plus,
  Send,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { queueApprovalCards } from "@/lib/actionable-cards.functions";
import { AppShell, EntityTag, Panel, StatCard, StatusPill, useScope } from "@/components/AppShell";
import {
  fmtDate,
  mondayOf,
  useEmployees,
  useMe,
  useTimesheetEntries,
  useTimesheets,
  type Timesheet,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/timesheets")({
  head: () => ({
    meta: [
      { title: "Timesheets — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Fill a weekly timesheet in seconds, then have HR approve it and finance sign it off for pay.",
      },
      { property: "og:title", content: "Timesheets — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Weekly hours, HR approval and finance sign-off in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TimesheetsPage,
});

function TimesheetsPage() {
  return (
    <AppShell title="Timesheets" subtitle="Fill the week · HR approves · finance signs off">
      <TimesheetsBody />
    </AppShell>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TASKS = [
  "Client delivery",
  "Internal project",
  "Support / maintenance",
  "Meetings",
  "Documentation",
  "Training / learning",
  "Recruitment / interviews",
  "Admin",
  "Other",
];

type TaskRow = {
  key: string;
  date: string;
  project: string;
  task: string;
  hours: string;
  notes: string;
};

let keyCounter = 0;
function newKey() {
  keyCounter += 1;
  return `row-${keyCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function toISODate(value: unknown): string | null {
  if (value instanceof Date) return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function shiftWeek(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekLabel(iso: string) {
  return `${fmtDate(iso)} – ${fmtDate(shiftWeek(iso, 6))}`;
}

function stageOf(sheet: Timesheet | undefined) {
  if (!sheet) return "not started";
  if (sheet.status === "rejected") return "sent back";
  if (sheet.status === "draft") return "draft";
  if (sheet.status === "submitted") return "with HR";
  if (sheet.finance_status === "approved") return "cleared for pay";
  return "with finance";
}

function TimesheetsBody() {
  const { data: me } = useMe();
  const { companyId, companyById, canSeeAll } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: sheets = [] } = useTimesheets();
  const queryClient = useQueryClient();
  const queueCards = useServerFn(queueApprovalCards);
  const isHr = !!me?.isMaster || !!me?.hrCompanyId;
  const myId = me?.employee?.id;
  const fetchProjects = useServerFn(listWorkProjects);
  const { data: projectData, isLoading: projectsLoading } = useQuery({
    queryKey: ["work_projects"],
    queryFn: () => fetchProjects(),
    staleTime: 5 * 60_000,
  });
  const projectOptions = useMemo(
    () => (projectData?.projects ?? []).map(projectLabel),
    [projectData],
  );

  const [tab, setTab] = useState<"mine" | "approvals">("mine");
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<"hr" | "finance" | "all">("hr");
  const fileRef = useRef<HTMLInputElement>(null);

  const mySheets = useMemo(
    () => sheets.filter((s) => s.employee_id === myId),
    [sheets, myId],
  );
  const mySheet = mySheets.find((s) => s.week_start === weekStart);
  const { data: entries = [] } = useTimesheetEntries(mySheet?.id);

  const dayDates = useMemo(() => {
    const start = new Date(weekStart + "T00:00:00");
    return DAYS.map((_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }, [weekStart]);

  useEffect(() => {
    setRows(null);
    setDirty(false);
  }, [weekStart, mySheet?.id]);

  const lines: TaskRow[] = useMemo(
    () =>
      rows ??
      entries.map((e) => ({
        key: e.id,
        date: e.work_date,
        project: (e as { work_project?: string }).work_project ?? "",
        task: e.project || TASKS[0]!,
        hours: String(e.hours),
        notes: e.notes ?? "",
      })),
    [rows, entries],
  );

  const linesFor = (date: string) => lines.filter((r) => r.date === date);
  const dayTotal = (date: string) =>
    round(linesFor(date).reduce((sum, r) => sum + (parseFloat(r.hours) || 0), 0));
  const totalHours = round(lines.reduce((sum, r) => sum + (parseFloat(r.hours) || 0), 0));

  const locked = mySheet?.status === "submitted" || mySheet?.status === "approved";

  const apply = (next: TaskRow[]) => {
    setRows(next);
    setDirty(true);
  };
  const lastProject = lines.length ? lines[lines.length - 1]!.project : "";
  const addLine = (date: string, task = TASKS[0]!, hours = "", notes = "") =>
    apply([...lines, { key: newKey(), date, project: lastProject, task, hours, notes }]);
  const patchLine = (key: string, patch: Partial<TaskRow>) =>
    apply(lines.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeLine = (key: string) => apply(lines.filter((r) => r.key !== key));

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      if (!myId) throw new Error("Your employee record is not linked yet");
      if (submit) {
        const missing = lines.filter((r) => (parseFloat(r.hours) || 0) > 0 && !r.project.trim());
        if (missing.length)
          throw new Error(`Pick a Project on ${missing.length} line${missing.length > 1 ? "s" : ""} before sending`);
      }
      let sheetId = mySheet?.id;
      const base = {
        total_hours: totalHours,
        status: (submit ? "submitted" : "draft") as "submitted" | "draft",
      };
      if (!sheetId) {
        const { data, error } = await supabase
          .from("timesheets")
          .insert({
            employee_id: myId,
            week_start: weekStart,
            ...base,
            submitted_at: submit ? new Date().toISOString() : null,
          })
          .select("id")
          .single();
        if (error) throw error;
        sheetId = data.id;
      } else {
        const { error } = await supabase
          .from("timesheets")
          .update({
            ...base,
            submitted_at: submit ? new Date().toISOString() : null,
            finance_status: "pending",
            finance_note: "",
            finance_decided_at: null,
            decided_at: null,
          })
          .eq("id", sheetId);
        if (error) throw error;
      }
      const payload = lines
        .filter((r) => (parseFloat(r.hours) || 0) > 0)
        .map((r) => ({
          timesheet_id: sheetId!,
          work_date: r.date,
          hours: parseFloat(r.hours) || 0,
          project: r.task || "General work",
          work_project: r.project.trim(),
          notes: r.notes ?? "",
        }));
      await supabase.from("timesheet_entries").delete().eq("timesheet_id", sheetId);
      if (payload.length) {
        const { error } = await supabase.from("timesheet_entries").insert(payload);
        if (error) throw error;
      }
      return submit ? sheetId : null;
    },
    onSuccess: (sheetId, submit) => {
      setDirty(false);
      if (submit) toast.success("Week sent for approval");
      if (sheetId) void queueCards({ data: { kind: "timesheet", id: sheetId } }).catch(() => undefined);
      queryClient.invalidateQueries({ queryKey: ["timesheets"] });
      queryClient.invalidateQueries({ queryKey: ["timesheet_entries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Autosave the draft shortly after typing stops, so the only button a person
  // needs to press is "Send for approval".
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty || locked) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save.mutate(false), 1200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, dirty, locked]);

  const fillStandard = () => {
    const kept = lines.filter((r) => (parseFloat(r.hours) || 0) > 0);
    const next = [...kept];
    dayDates.slice(0, 5).forEach((d) => {
      if (!kept.some((r) => r.date === d)) {
        next.push({ key: newKey(), date: d, project: lastProject, task: TASKS[0]!, hours: "8", notes: "" });
      }
    });
    apply(next);
  };

  const clearWeek = () => apply([]);

  const copyLastWeek = async () => {
    const prev = mySheets.find((s) => s.week_start === shiftWeek(weekStart, -7));
    if (!prev) {
      toast.error("No hours logged last week");
      return;
    }
    const { data } = await supabase
      .from("timesheet_entries")
      .select("work_date,hours,project,work_project,notes")
      .eq("timesheet_id", prev.id);
    const next = (data ?? []).map((e) => ({
      key: newKey(),
      date: shiftWeek(e.work_date as string, 7),
      project: (e.work_project as string) ?? "",
      task: (e.project as string) || TASKS[0]!,
      hours: String(e.hours),
      notes: (e.notes as string) ?? "",
    }));
    if (!next.length) {
      toast.error("Last week had no tasks");
      return;
    }
    apply(next);
    toast.success(`Copied ${next.length} task${next.length > 1 ? "s" : ""}`);
  };

  const downloadTemplate = () => {
    const sample = dayDates.slice(0, 5).map((d) => ({
      Date: d,
      Project: projectOptions[0] ?? "",
      Task: TASKS[0],
      Hours: 8,
      Notes: "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sample), "Week");
    XLSX.writeFile(wb, `timesheet-${weekStart}.xlsx`);
  };

  const importFile = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("The file has no sheets");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]!);
      const next: TaskRow[] = [];
      let skipped = 0;
      for (const r of raw) {
        const get = (name: string) => {
          const key = Object.keys(r).find((k) => k.trim().toLowerCase() === name);
          return key ? r[key] : undefined;
        };
        const date = toISODate(get("date"));
        const hours = parseFloat(String(get("hours") ?? ""));
        if (!date || !dayDates.includes(date) || !(hours > 0)) {
          skipped++;
          continue;
        }
        next.push({
          key: newKey(),
          date,
          project: String(get("project") ?? "").trim(),
          task: String(get("task") ?? "").trim() || TASKS[0]!,
          hours: String(hours),
          notes: String(get("notes") ?? "").trim(),
        });
      }
      if (!next.length) {
        toast.error("No usable rows — check the Date, Task and Hours columns");
        return;
      }
      apply(next);
      toast.success(
        `Loaded ${next.length} task${next.length > 1 ? "s" : ""}${skipped ? ` · ${skipped} row(s) skipped` : ""}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that file");
    }
  };


  const scopedIds = useMemo(
    () =>
      new Set(
        (companyId ? employees.filter((e) => e.company_id === companyId) : employees).map(
          (e) => e.id,
        ),
      ),
    [employees, companyId],
  );

  const teamSheets = useMemo(
    () => sheets.filter((s) => scopedIds.has(s.employee_id) && s.employee_id !== myId),
    [sheets, scopedIds, myId],
  );
  const hrQueue = teamSheets.filter((s) => s.status === "submitted");
  const financeQueue = teamSheets.filter(
    (s) => s.status === "approved" && s.finance_status === "pending",
  );
  const shown = queue === "hr" ? hrQueue : queue === "finance" ? financeQueue : teamSheets;

  const decide = useMutation({
    mutationFn: async ({
      ids,
      action,
    }: {
      ids: string[];
      action: "hr_approve" | "hr_reject" | "fin_approve" | "fin_reject";
    }) => {
      const now = new Date().toISOString();
      const patch =
        action === "hr_approve"
          ? { status: "approved" as const, decided_at: now, finance_status: "pending" as const }
          : action === "hr_reject"
            ? { status: "rejected" as const, decided_at: now }
            : action === "fin_approve"
              ? { finance_status: "approved" as const, finance_decided_at: now }
              : {
                  finance_status: "rejected" as const,
                  finance_decided_at: now,
                  status: "rejected" as const,
                };
      const { error } = await supabase.from("timesheets").update(patch).in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} timesheet${count > 1 ? "s" : ""} updated`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["timesheets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedIds = [...selected].filter((id) => shown.some((s) => s.id === id));

  return (
    <>
      {isHr && (
        <div className="mb-4 inline-flex p-1 rounded-xl bg-panel ring-1 ring-black/5">
          {(
            [
              ["mine", "My week"],
              ["approvals", `Approvals${hrQueue.length + financeQueue.length ? ` · ${hrQueue.length + financeQueue.length}` : ""}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`h-8 px-4 rounded-lg text-[12.5px] font-medium cursor-pointer transition-colors ${
                tab === key ? "bg-brand text-paper shadow-sm" : "text-ink-soft hover:bg-ink/5"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(!isHr || tab === "mine") && (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="This week"
              value={totalHours}
              suffix="hrs"
              hint={weekLabel(weekStart)}
              onClick={() => setWeekStart(mondayOf(new Date()))}
              active={weekStart === mondayOf(new Date())}
            />
            <StatCard label="Stage" value={stageOf(mySheet)} />
            <StatCard
              label="Weeks logged"
              value={mySheets.length}
              hint="in your history"
            />
            <StatCard
              label="Cleared for pay"
              value={mySheets.filter((s) => s.finance_status === "approved").length}
              hintTone="good"
              hint="signed off by finance"
            />
          </section>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setWeekStart(shiftWeek(weekStart, -7))}
              className="size-8 grid place-items-center rounded-lg ring-1 ring-line cursor-pointer hover:bg-ink/5"
              aria-label="Previous week"
            >
              <ChevronLeft className="size-4" />
            </button>
            {[3, 2, 1, 0].map((back) => {
              const iso = shiftWeek(mondayOf(new Date()), -7 * back);
              const sheet = mySheets.find((s) => s.week_start === iso);
              const active = iso === weekStart;
              return (
                <button
                  key={iso}
                  onClick={() => setWeekStart(iso)}
                  className={`h-8 px-3 rounded-full text-[12px] font-medium cursor-pointer inline-flex items-center gap-2 transition-colors ${
                    active ? "bg-brand text-paper shadow-sm" : "ring-1 ring-line hover:bg-ink/5"
                  }`}
                >
                  {back === 0 ? "This week" : fmtDate(iso)}
                  <span
                    className={`size-1.5 rounded-full ${
                      sheet?.finance_status === "approved"
                        ? "bg-perp"
                        : sheet?.status === "submitted" || sheet?.status === "approved"
                          ? "bg-cloud"
                          : sheet
                            ? "bg-whilter"
                            : "bg-line"
                    }`}
                  />
                </button>
              );
            })}
            <button
              onClick={() => setWeekStart(shiftWeek(weekStart, 7))}
              className="size-8 grid place-items-center rounded-lg ring-1 ring-line cursor-pointer hover:bg-ink/5"
              aria-label="Next week"
            >
              <ChevronRight className="size-4" />
            </button>
            {mySheet && (
              <span className="ml-1">
                <StatusPill status={mySheet.status} />
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2">
              <Panel
                title={weekLabel(weekStart)}
                meta={
                  !locked && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={fillStandard}
                        className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5"
                      >
                        <Wand2 className="size-3" /> 8h Mon–Fri
                      </button>
                      <button
                        onClick={copyLastWeek}
                        className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5"
                      >
                        <Copy className="size-3" /> Copy last week
                      </button>
                      <button
                        onClick={() => fileRef.current?.click()}
                        className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5"
                      >
                        <Upload className="size-3" /> Import week
                      </button>
                      <button
                        onClick={downloadTemplate}
                        className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5"
                      >
                        <Download className="size-3" /> Template
                      </button>
                      <button
                        onClick={clearWeek}
                        className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5"
                      >
                        <Eraser className="size-3" /> Clear
                      </button>
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void importFile(f);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  )
                }
              >
                <div className="p-4">
                  <div className="space-y-2">
                    {DAYS.map((d, i) => {
                      const date = dayDates[i]!;
                      const weekend = i > 4;
                      const dayLines = linesFor(date);
                      const total = dayTotal(date);
                      if (weekend && !dayLines.length && locked) return null;
                      return (
                        <div
                          key={d}
                          className={`rounded-xl ring-1 ring-line ${weekend ? "bg-paper/40" : "bg-paper"}`}
                        >
                          <div className="px-3 py-2 flex items-center gap-2 border-b border-line">
                            <span className="label-mono w-24">
                              {d} {date.slice(8, 10)}/{date.slice(5, 7)}
                            </span>
                            <span
                              className={`text-[12px] font-mono ${
                                total > 0 ? "font-semibold" : "text-ink-soft"
                              }`}
                            >
                              {total}h
                            </span>
                            {!locked && (
                              <button
                                onClick={() => addLine(date)}
                                className="ml-auto h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5"
                              >
                                <Plus className="size-3" /> Add task
                              </button>
                            )}
                          </div>
                          <div className="p-2 space-y-2">
                            {dayLines.map((r) => (
                              <div
                                key={r.key}
                                className="grid grid-cols-[minmax(0,1fr)_5rem_2.25rem] gap-2 sm:flex sm:flex-wrap sm:items-center"
                              >
                                <ProjectPicker
                                  disabled={locked}
                                  value={r.project}
                                  options={projectOptions}
                                  loading={projectsLoading}
                                  onChange={(v) => patchLine(r.key, { project: v })}
                                  label={`Project for ${d}`}
                                  className="col-span-3 w-full sm:w-72"
                                />
                                <select
                                  disabled={locked}
                                  value={TASKS.includes(r.task) ? r.task : "Other"}
                                  onChange={(e) => patchLine(r.key, { task: e.target.value })}
                                  aria-label={`Task for ${d}`}
                                  className="h-9 px-2 rounded-lg bg-panel ring-1 ring-line text-[13px] outline-none focus:ring-ink disabled:opacity-60 min-w-0 w-full sm:w-44"
                                >
                                  {TASKS.map((t) => (
                                    <option key={t} value={t}>
                                      {t}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  inputMode="decimal"
                                  disabled={locked}
                                  value={r.hours}
                                  onChange={(e) => patchLine(r.key, { hours: e.target.value })}
                                  placeholder="0"
                                  aria-label={`Hours for ${d}`}
                                  className="h-9 w-full sm:w-20 px-2 rounded-lg bg-panel ring-1 ring-line text-[14px] font-mono text-center outline-none focus:ring-ink disabled:opacity-60"
                                />
                                {!locked ? (
                                  <button
                                    onClick={() => removeLine(r.key)}
                                    aria-label="Remove task"
                                    className="size-9 grid place-items-center rounded-lg ring-1 ring-line cursor-pointer hover:bg-ink/5 sm:order-last"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                ) : (
                                  <span className="sm:hidden" />
                                )}
                                <input
                                  disabled={locked}
                                  value={r.notes}
                                  onChange={(e) => patchLine(r.key, { notes: e.target.value })}
                                  placeholder="What did you work on?"
                                  aria-label={`Notes for ${d}`}
                                  className="col-span-3 h-9 w-full sm:w-auto sm:flex-1 sm:min-w-40 px-2.5 rounded-lg bg-panel ring-1 ring-line text-[13px] outline-none focus:ring-ink disabled:opacity-60"
                                />
                              </div>
                            ))}
                            {!dayLines.length && (
                              <p className="px-1 py-1.5 text-[12px] text-ink-soft">
                                No tasks logged.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>


                  <div className="mt-4 flex items-center gap-3 flex-wrap">
                    <p className="text-[13px]">
                      <span className="font-semibold">{totalHours} hrs</span>
                      <span className="text-ink-soft"> of 40</span>
                    </p>
                    <div className="h-1.5 w-32 rounded-full bg-line overflow-hidden">
                      <div
                        className="h-full bg-brand"
                        style={{ width: `${Math.min(100, (totalHours / 40) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-mono text-ink-soft">
                      {locked
                        ? `Locked — ${stageOf(mySheet)}`
                        : save.isPending
                          ? "Saving…"
                          : dirty
                            ? "Unsaved"
                            : "Saved automatically"}
                    </span>
                    <button
                      disabled={save.isPending || locked || totalHours <= 0}
                      onClick={() => save.mutate(true)}
                      className="ml-auto h-10 px-4 rounded-xl bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      <Send className="size-3.5" />
                      Send for approval
                    </button>
                  </div>

                  {mySheet?.status === "rejected" && (
                    <p className="mt-3 text-[12px] text-destructive">
                      This week was sent back. Fix the hours and send it again.
                    </p>
                  )}
                </div>
              </Panel>
            </div>

            <aside className="space-y-4">
              <Panel title="Where your weeks are">
                <div className="divide-y divide-line">
                  {mySheets.slice(0, 8).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setWeekStart(s.week_start)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left cursor-pointer hover:bg-ink/[0.03]"
                    >
                      <span>
                        <span className="text-[13px] font-mono block">{fmtDate(s.week_start)}</span>
                        <span className="text-[11px] font-mono text-ink-soft">{stageOf(s)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-[12px] font-mono text-ink-soft">{s.total_hours}h</span>
                        <StatusPill status={s.status} />
                      </span>
                    </button>
                  ))}
                  {!mySheets.length && (
                    <p className="px-4 py-8 text-center text-[13px] text-ink-soft">
                      Nothing logged yet — fill this week and send it.
                    </p>
                  )}
                </div>
              </Panel>
              <div className="rounded-[14px] bg-brand text-paper p-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-paper/50">
                  How it works
                </p>
                <p className="text-[13px] mt-2">
                  A standard week is 40 hours, split across the tasks you worked on each day. You can
                  add tasks by hand or upload a filled week from Excel. Everything saves on its own —
                  press Send once. HR approves, then finance signs the week off for pay.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}

      {isHr && tab === "approvals" && (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Waiting on HR"
              value={hrQueue.length}
              hintTone="warn"
              onClick={() => setQueue("hr")}
              active={queue === "hr"}
            />
            <StatCard
              label="Waiting on finance"
              value={financeQueue.length}
              hintTone="warn"
              onClick={() => setQueue("finance")}
              active={queue === "finance"}
            />
            <StatCard
              label="Cleared for pay"
              value={teamSheets.filter((s) => s.finance_status === "approved").length}
              hintTone="good"
              onClick={() => setQueue("all")}
              active={false}
            />
            <StatCard
              label="All weeks"
              value={teamSheets.length}
              onClick={() => setQueue("all")}
              active={queue === "all"}
            />
          </section>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(
              [
                ["hr", `HR approval · ${hrQueue.length}`],
                ["finance", `Finance sign-off · ${financeQueue.length}`],
                ["all", `Everything · ${teamSheets.length}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setQueue(key);
                  setSelected(new Set());
                }}
                className={`h-8 px-3 rounded-full text-[12px] font-medium cursor-pointer transition-colors ${
                  queue === key ? "bg-brand text-paper shadow-sm" : "ring-1 ring-line hover:bg-ink/5"
                }`}
              >
                {label}
              </button>
            ))}
            {selectedIds.length > 0 && queue !== "all" && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[12px] text-ink-soft">{selectedIds.length} selected</span>
                <button
                  onClick={() =>
                    decide.mutate({
                      ids: selectedIds,
                      action: queue === "hr" ? "hr_approve" : "fin_approve",
                    })
                  }
                  className="h-8 px-3 rounded-lg bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep inline-flex items-center gap-1.5"
                >
                  <Check className="size-3.5" />
                  {queue === "hr" ? "Approve selected" : "Sign off selected"}
                </button>
                <button
                  onClick={() =>
                    decide.mutate({
                      ids: selectedIds,
                      action: queue === "hr" ? "hr_reject" : "fin_reject",
                    })
                  }
                  className="h-8 px-3 rounded-lg ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5"
                >
                  <X className="size-3.5" /> Send back
                </button>
              </div>
            )}
          </div>

          <div className="mt-4">
            <Panel
              title={
                queue === "hr"
                  ? "Weeks waiting for HR"
                  : queue === "finance"
                    ? "Weeks waiting for finance"
                    : "All team weeks"
              }
              meta={
                queue !== "all" &&
                shown.length > 0 && (
                  <button
                    onClick={() =>
                      setSelected(
                        selectedIds.length === shown.length
                          ? new Set()
                          : new Set(shown.map((s) => s.id)),
                      )
                    }
                    className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                  >
                    {selectedIds.length === shown.length ? "Clear selection" : "Select all"}
                  </button>
                )
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left label-mono border-b border-line">
                      {queue !== "all" && <th className="pl-4 py-2.5 w-8" />}
                      <th className="px-4 py-2.5 font-medium">Employee</th>
                      {canSeeAll && <th className="px-4 py-2.5 font-medium">Entity</th>}
                      <th className="px-4 py-2.5 font-medium">Week</th>
                      <th className="px-4 py-2.5 font-medium">Hours</th>
                      <th className="px-4 py-2.5 font-medium">Stage</th>
                      <th className="px-4 py-2.5 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shown.map((s) => {
                      const emp = employees.find((e) => e.id === s.employee_id);
                      const canAct =
                        s.status === "submitted"
                          ? "hr"
                          : s.status === "approved" && s.finance_status === "pending"
                            ? "finance"
                            : null;
                      return (
                        <tr key={s.id} className="hover:bg-ink/[0.03]">
                          {queue !== "all" && (
                            <td className="pl-4 py-3">
                              <input
                                type="checkbox"
                                aria-label={`Select ${emp?.full_name ?? "timesheet"}`}
                                checked={selected.has(s.id)}
                                onChange={() => toggle(s.id)}
                                className="size-4 cursor-pointer accent-black"
                              />
                            </td>
                          )}
                          <td className="px-4 py-3 font-medium">{emp?.full_name ?? "—"}</td>
                          {canSeeAll && (
                            <td className="px-4 py-3">
                              <EntityTag company={emp ? companyById(emp.company_id) : undefined} />
                            </td>
                          )}
                          <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                            {fmtDate(s.week_start)}
                          </td>
                          <td className="px-4 py-3 font-mono">{s.total_hours}</td>
                          <td className="px-4 py-3 text-[12px] text-ink-soft">{stageOf(s)}</td>
                          <td className="px-4 py-3 text-right">
                            {canAct ? (
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() =>
                                    decide.mutate({
                                      ids: [s.id],
                                      action: canAct === "hr" ? "hr_approve" : "fin_approve",
                                    })
                                  }
                                  className="h-7 px-2.5 rounded-md bg-brand text-paper text-[11px] font-semibold cursor-pointer hover:bg-brand-deep"
                                >
                                  {canAct === "hr" ? "Approve" : "Sign off"}
                                </button>
                                <button
                                  onClick={() =>
                                    decide.mutate({
                                      ids: [s.id],
                                      action: canAct === "hr" ? "hr_reject" : "fin_reject",
                                    })
                                  }
                                  className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                                >
                                  Send back
                                </button>
                              </div>
                            ) : (
                              <StatusPill status={s.status} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!shown.length && (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-ink-soft">
                          Nothing waiting here.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
