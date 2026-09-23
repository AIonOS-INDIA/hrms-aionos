import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, FilterNote, Panel, StatCard, useScope } from "@/components/AppShell";
import { Input, Select } from "@/routes/_authenticated/employees";
import {
  fmtDate,
  useEmployees,
  useMe,
  useTrainingCourses,
  useTrainingEnrollments,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/learning")({
  head: () => ({
    meta: [
      { title: "Learning — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Course catalogue, mandatory training assignments and completion tracking for employees across the group.",
      },
      { property: "og:title", content: "Learning — AIONOS HR Control Tower" },
      { property: "og:description", content: "Courses, assignments and progress." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LearningPage,
});

function LearningPage() {
  return (
    <AppShell title="Learning" subtitle="Courses · assignments · progress">
      <LearningBody />
    </AppShell>
  );
}

function LearningBody() {
  const { data: me } = useMe();
  const { companyId } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: courses = [] } = useTrainingCourses();
  const { data: enrollments = [] } = useTrainingEnrollments();
  const queryClient = useQueryClient();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId;
  const isMaster = !!me?.isMaster;
  const myId = me?.employee?.id;

  const scoped = useMemo(
    () => (companyId ? employees.filter((e) => e.company_id === companyId) : employees),
    [employees, companyId],
  );
  const scopedIds = new Set(scoped.map((e) => e.id));

  const visibleCourses = courses.filter(
    (c) => !c.company_id || !companyId || c.company_id === companyId,
  );
  const visibleEnrollments = isHr
    ? enrollments.filter((e) => scopedIds.has(e.employee_id))
    : enrollments.filter((e) => e.employee_id === myId);
  const myEnrollments = enrollments.filter((e) => e.employee_id === myId);

  const [courseForm, setCourseForm] = useState({
    title: "",
    provider: "In-house",
    category: "Compliance",
    hours: "2",
    mandatory: "yes",
    scope: "group",
  });
  const [tile, setTile] = useState<string | null>(null);
  const [assign, setAssign] = useState({ course_id: "", employee_id: "", due_date: "" });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["training_courses"] });
    queryClient.invalidateQueries({ queryKey: ["training_enrollments"] });
  };

  const addCourse = useMutation({
    mutationFn: async () => {
      if (!courseForm.title.trim()) throw new Error("Name the course");
      const { error } = await supabase.from("training_courses").insert({
        company_id: courseForm.scope === "group" ? null : (companyId ?? me?.hrCompanyId ?? null),
        title: courseForm.title.trim(),
        provider: courseForm.provider,
        category: courseForm.category,
        hours: Number(courseForm.hours) || 0,
        mandatory: courseForm.mandatory === "yes",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Course added");
      setCourseForm({ ...courseForm, title: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignCourse = useMutation({
    mutationFn: async (allOfScope: boolean) => {
      const courseId = assign.course_id || visibleCourses[0]?.id;
      if (!courseId) throw new Error("Add a course first");
      const targets = allOfScope
        ? scoped.filter((e) => e.status !== "offboarded").map((e) => e.id)
        : [assign.employee_id || scoped[0]?.id].filter(Boolean);
      if (!targets.length) throw new Error("Pick someone to assign");
      const rows = targets.map((employee_id) => ({
        course_id: courseId,
        employee_id: employee_id as string,
        due_date: assign.due_date || null,
      }));
      const { error } = await supabase
        .from("training_enrollments")
        .upsert(rows, { onConflict: "course_id,employee_id", ignoreDuplicates: true });
      if (error) throw error;
      return targets.length;
    },
    onSuccess: (count) => {
      toast.success(`Assigned to ${count} ${count === 1 ? "person" : "people"}`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setProgress = useMutation({
    mutationFn: async ({ id, progress }: { id: string; progress: number }) => {
      const done = progress >= 100;
      const { error } = await supabase
        .from("training_enrollments")
        .update({
          progress,
          status: done ? "completed" : progress > 0 ? "in_progress" : "enrolled",
          completed_on: done ? new Date().toISOString().slice(0, 10) : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeCourse = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("training_courses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Course removed");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const completed = visibleEnrollments.filter((e) => e.status === "completed").length;
  const rate = visibleEnrollments.length
    ? Math.round((completed / visibleEnrollments.length) * 100)
    : 0;
  const inProgress = visibleEnrollments.filter((e) => e.status !== "completed").length;
  const shownEnrollments =
    tile === "completed"
      ? visibleEnrollments.filter((e) => e.status === "completed")
      : tile === "in_progress"
        ? visibleEnrollments.filter((e) => e.status !== "completed")
        : visibleEnrollments;
  const toggle = (k: string) => setTile((prev) => (prev === k ? null : k));

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Courses"
          value={visibleCourses.length}
          hint="in catalogue"
          onClick={() => setTile(null)}
          active={tile === null}
        />
        <StatCard
          label={isHr ? "Assignments" : "My courses"}
          value={visibleEnrollments.length}
          hint="all assignments"
          onClick={() => setTile(null)}
          active={false}
        />
        <StatCard
          label="Completed"
          value={completed}
          hintTone="good"
          onClick={() => toggle("completed")}
          active={tile === "completed"}
        />
        <StatCard
          label="In progress"
          value={inProgress}
          hintTone={rate >= 80 ? "good" : "warn"}
          hint={`${rate}% complete`}
          onClick={() => toggle("in_progress")}
          active={tile === "in_progress"}
        />
      </section>
      {tile && (
        <FilterNote
          label={tile.replace("_", " ")}
          count={shownEnrollments.length}
          onClear={() => setTile(null)}
        />
      )}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Panel title="Course catalogue">
            <div className="divide-y divide-line">
              {visibleCourses.map((c) => {
                const mine = myEnrollments.find((e) => e.course_id === c.id);
                return (
                  <div key={c.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">
                        {c.title}
                        {c.mandatory && (
                          <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-whilter/10 text-whilter">
                            required
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] font-mono text-ink-soft">
                        {c.category} · {c.provider} · {c.hours}h
                      </p>
                    </div>
                    {mine ? (
                      <span className="text-[11px] font-mono text-perp">
                        {mine.progress}% done
                      </span>
                    ) : null}
                    {isHr && (isMaster || c.company_id) && (
                      <button
                        onClick={() => removeCourse.mutate(c.id)}
                        className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium text-destructive cursor-pointer hover:bg-ink/5"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
              {!visibleCourses.length && (
                <p className="px-4 py-8 text-center text-[13px] text-ink-soft">
                  No courses yet.
                </p>
              )}
            </div>
          </Panel>

          <Panel
            title={isHr ? "Progress" : "My progress"}
            meta={<span className="label-mono">{shownEnrollments.length} records</span>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-mono border-b border-line">
                    {isHr && <th className="px-4 py-2.5 font-medium">Employee</th>}
                    <th className="px-4 py-2.5 font-medium">Course</th>
                    <th className="px-4 py-2.5 font-medium">Due</th>
                    <th className="px-4 py-2.5 font-medium">Progress</th>
                    <th className="px-4 py-2.5 font-medium text-right">Update</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shownEnrollments.map((en) => {
                    const course = courses.find((c) => c.id === en.course_id);
                    const own = en.employee_id === myId;
                    return (
                      <tr key={en.id} className="hover:bg-ink/[0.03]">
                        {isHr && (
                          <td className="px-4 py-3 font-medium">
                            {employees.find((e) => e.id === en.employee_id)?.full_name ?? "—"}
                          </td>
                        )}
                        <td className="px-4 py-3">{course?.title ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                          {en.due_date ? fmtDate(en.due_date) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 rounded-full bg-line overflow-hidden">
                              <div
                                className="h-full bg-perp"
                                style={{ width: `${en.progress}%` }}
                              />
                            </div>
                            <span className="font-mono text-[11px] text-ink-soft">
                              {en.progress}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {own || isHr ? (
                            <select
                              value={String(en.progress)}
                              onChange={(e) =>
                                setProgress.mutate({ id: en.id, progress: Number(e.target.value) })
                              }
                              className="h-7 px-1.5 rounded-md bg-paper ring-1 ring-line text-[11px] cursor-pointer"
                            >
                              {[0, 25, 50, 75, 100].map((p) => (
                                <option key={p} value={p}>
                                  {p}%
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-ink-soft">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!shownEnrollments.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                        Nothing assigned yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {isHr && (
          <aside className="space-y-4">
            <Panel title="Add a course">
              <div className="p-4 space-y-3">
                <Input
                  label="Title"
                  value={courseForm.title}
                  onChange={(v) => setCourseForm({ ...courseForm, title: v })}
                />
                <Input
                  label="Provider"
                  value={courseForm.provider}
                  onChange={(v) => setCourseForm({ ...courseForm, provider: v })}
                />
                <Select
                  label="Category"
                  value={courseForm.category}
                  onChange={(v) => setCourseForm({ ...courseForm, category: v })}
                  options={[
                    "Compliance",
                    "Security",
                    "Leadership",
                    "Technical",
                    "Product",
                    "Wellbeing",
                  ].map((s) => ({ value: s, label: s }))}
                />
                <Input
                  label="Hours"
                  type="number"
                  value={courseForm.hours}
                  onChange={(v) => setCourseForm({ ...courseForm, hours: v })}
                />
                <Select
                  label="Required"
                  value={courseForm.mandatory}
                  onChange={(v) => setCourseForm({ ...courseForm, mandatory: v })}
                  options={[
                    { value: "yes", label: "Required for everyone" },
                    { value: "no", label: "Optional" },
                  ]}
                />
                {isMaster && (
                  <Select
                    label="Available to"
                    value={courseForm.scope}
                    onChange={(v) => setCourseForm({ ...courseForm, scope: v })}
                    options={[
                      { value: "group", label: "All companies" },
                      { value: "company", label: "Selected company only" },
                    ]}
                  />
                )}
                <button
                  onClick={() => addCourse.mutate()}
                  className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                >
                  Add course
                </button>
              </div>
            </Panel>

            <Panel title="Assign a course">
              <div className="p-4 space-y-3">
                <Select
                  label="Course"
                  value={assign.course_id || (visibleCourses[0]?.id ?? "")}
                  onChange={(v) => setAssign({ ...assign, course_id: v })}
                  options={visibleCourses.map((c) => ({ value: c.id, label: c.title }))}
                />
                <Select
                  label="Employee"
                  value={assign.employee_id || (scoped[0]?.id ?? "")}
                  onChange={(v) => setAssign({ ...assign, employee_id: v })}
                  options={scoped.map((e) => ({ value: e.id, label: e.full_name }))}
                />
                <Input
                  label="Complete by"
                  type="date"
                  value={assign.due_date}
                  onChange={(v) => setAssign({ ...assign, due_date: v })}
                />
                <button
                  onClick={() => assignCourse.mutate(false)}
                  className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                >
                  Assign
                </button>
                <button
                  onClick={() => assignCourse.mutate(true)}
                  className="w-full h-9 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5"
                >
                  Assign to everyone in scope
                </button>
              </div>
            </Panel>
          </aside>
        )}
      </div>
    </>
  );
}
