import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, FilterNote, EntityTag, Panel, StatCard, StatusPill, useScope } from "@/components/AppShell";
import { Combo, Input, Select } from "@/routes/_authenticated/employees";
import {
  fmtDate,
  useEmployeeGoals,
  useEmployees,
  useMe,
  usePerformanceReviews,
  type EmployeeGoal,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({
    meta: [
      { title: "Performance — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Set employee goals, run performance reviews and track progress across AIONOS group companies.",
      },
      { property: "og:title", content: "Performance — AIONOS HR Control Tower" },
      { property: "og:description", content: "Goals, reviews and progress tracking." },
    ],
  }),
  component: PerformancePage,
});

function PerformancePage() {
  return (
    <AppShell title="Performance" subtitle="Goals · reviews · progress">
      <PerformanceBody />
    </AppShell>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function PerformanceBody() {
  const { data: me } = useMe();
  const { companyId, companyById, canSeeAll } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: goals = [] } = useEmployeeGoals();
  const { data: reviews = [] } = usePerformanceReviews();
  const queryClient = useQueryClient();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId;
  const myId = me?.employee?.id;

  const myReports = useMemo(
    () =>
      employees.filter((e) => myId && e.manager_id === myId && e.status !== "offboarded"),
    [employees, myId],
  );
  const isManager = !isHr && myReports.length > 0;
  const canManage = isHr || isManager;

  const scoped = useMemo(() => {
    if (!isHr) return myReports;
    return (companyId ? employees.filter((e) => e.company_id === companyId) : employees).filter(
      (e) => e.status !== "offboarded",
    );
  }, [employees, companyId, isHr, myReports]);

  const [tile, setTile] = useState<string | null>(null);
  const [focus, setFocus] = useState<string>("");
  const focusId = canManage ? focus || (scoped[0]?.id ?? myId ?? "") : (myId ?? "");
  const focusEmployee = employees.find((e) => e.id === focusId);

  const scopedIds = useMemo(() => new Set(scoped.map((e) => e.id)), [scoped]);
  const visibleGoals = isHr
    ? goals.filter((g) => scopedIds.has(g.employee_id))
    : goals;
  const visibleReviews = isHr
    ? reviews.filter((r) => scopedIds.has(r.employee_id))
    : reviews;
  /** Review periods already used, so everyone names cycles the same way. */
  const periodOptions = useMemo(
    () => [...new Set(reviews.map((r) => r.period.trim()).filter(Boolean))].sort(),
    [reviews],
  );

  const focusGoals = visibleGoals.filter((g) => g.employee_id === focusId);
  const focusReviews = visibleReviews.filter((r) => r.employee_id === focusId);
  /** Oldest rating first, so the timeline reads top-to-bottom. */
  const ratingHistory = useMemo(
    () =>
      [...focusReviews].sort((a, b) => a.review_date.localeCompare(b.review_date)),
    [focusReviews],
  );

  const [goalForm, setGoalForm] = useState({
    title: "",
    details: "",
    target_date: today(),
    weight: "1",
  });
  const [reviewForm, setReviewForm] = useState({
    period: `${new Date().getFullYear()} H${new Date().getMonth() < 6 ? 1 : 2}`,
    review_date: today(),
    rating: "3",
    strengths: "",
    improvements: "",
    summary: "",
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["employee_goals"] });
    queryClient.invalidateQueries({ queryKey: ["performance_reviews"] });
  };

  const addGoal = useMutation({
    mutationFn: async () => {
      if (!focusId) throw new Error("Pick an employee first");
      if (!goalForm.title.trim()) throw new Error("Give the goal a title");
      const { error } = await supabase.from("employee_goals").insert({
        employee_id: focusId,
        title: goalForm.title.trim(),
        details: goalForm.details,
        target_date: goalForm.target_date,
        weight: Number(goalForm.weight) || 1,
        progress: 0,
        status: "active",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Goal added");
      setGoalForm({ title: "", details: "", target_date: today(), weight: "1" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateGoal = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<EmployeeGoal> }) => {
      const { error } = await supabase.from("employee_goals").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeGoal = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_goals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Goal removed");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addReview = useMutation({
    mutationFn: async (status: "draft" | "shared") => {
      if (!focusId) throw new Error("Pick an employee first");
      if (!reviewForm.period.trim()) throw new Error("Name the review period");
      const { error } = await supabase.from("performance_reviews").insert({
        employee_id: focusId,
        period: reviewForm.period.trim(),
        review_date: reviewForm.review_date,
        rating: Number(reviewForm.rating) || 3,
        strengths: reviewForm.strengths,
        improvements: reviewForm.improvements,
        summary: reviewForm.summary,
        status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Review saved");
      setReviewForm({ ...reviewForm, strengths: "", improvements: "", summary: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const shareReview = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("performance_reviews")
        .update({ status: "shared" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Review shared with the employee");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const avg = (list: EmployeeGoal[]) =>
    list.length ? Math.round(list.reduce((s, g) => s + Number(g.progress), 0) / list.length) : 0;

  const toggle = (k: string) => setTile((prev) => (prev === k ? null : k));
  const scopedShown =
    tile === "overdue"
      ? scoped.filter((e) =>
          visibleGoals.some(
            (g) => g.employee_id === e.id && g.status === "active" && g.target_date < today(),
          ),
        )
      : tile === "reviews"
        ? scoped.filter((e) => visibleReviews.some((r) => r.employee_id === e.id))
        : tile === "active"
          ? scoped.filter((e) =>
              visibleGoals.some((g) => g.employee_id === e.id && g.status === "active"),
            )
          : scoped;

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label={isHr ? "Goals in scope" : isManager ? "Team goals" : "My goals"}
          value={visibleGoals.length}
          hint={`${visibleGoals.filter((g) => g.status === "achieved").length} achieved`}
          hintTone="good"
          onClick={() => setTile(null)}
          active={tile === null}
        />
        <StatCard
          label="Average progress"
          value={avg(visibleGoals)}
          suffix="%"
          hint={isHr ? "across this scope" : "across your goals"}
          onClick={() => toggle("active")}
          active={tile === "active"}
        />
        <StatCard
          label={isHr ? "Reviews recorded" : "Reviews shared"}
          value={visibleReviews.length}
          hint={
            isHr ? `${visibleReviews.filter((r) => r.status === "draft").length} still draft` : ""
          }
          hintTone="warn"
          onClick={() => toggle("reviews")}
          active={tile === "reviews"}
        />
        <StatCard
          label="Overdue goals"
          value={
            visibleGoals.filter((g) => g.status === "active" && g.target_date < today()).length
          }
          hintTone="warn"
          onClick={() => toggle("overdue")}
          active={tile === "overdue"}
        />
      </section>
      {tile && (
        <FilterNote
          label={
            tile === "overdue" ? "people with overdue goals" : tile === "reviews" ? "people with reviews" : "people with active goals"
          }
          count={scopedShown.length}
          onClear={() => setTile(null)}
        />
      )}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          {canManage && (
            <Panel title={`Team progress · ${scopedShown.length}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left label-mono border-b border-line">
                      <th className="px-2 sm:px-4 py-2.5 font-medium">Employee</th>
                      {canSeeAll && (
                        <th className="px-2 sm:px-4 py-2.5 font-medium hidden md:table-cell">Entity</th>
                      )}
                      <th className="px-2 sm:px-4 py-2.5 font-medium hidden sm:table-cell">Goals</th>
                      <th className="px-2 sm:px-4 py-2.5 font-medium">Progress</th>
                      <th className="px-2 sm:px-4 py-2.5 font-medium hidden sm:table-cell">
                        Avg rating
                      </th>
                      <th className="px-2 sm:px-4 py-2.5 font-medium hidden lg:table-cell">Last review</th>
                      <th className="px-2 sm:px-4 py-2.5 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {scopedShown.map((e) => {
                      const g = visibleGoals.filter((x) => x.employee_id === e.id);
                      const rs = visibleReviews.filter((x) => x.employee_id === e.id);
                      const last = rs[0];
                      const avgRating = rs.length
                        ? (rs.reduce((sum, x) => sum + Number(x.rating), 0) / rs.length).toFixed(1)
                        : null;
                      const pct = avg(g);
                      return (
                        <tr
                          key={e.id}
                          className={`hover:bg-ink/[0.03] ${focusId === e.id ? "bg-ink/[0.04]" : ""}`}
                        >
                          <td className="px-2 sm:px-4 py-3">
                            <p className="font-medium">{e.full_name}</p>
                            <p className="text-[11px] font-mono text-ink-soft">{e.job_title}</p>
                          </td>
                          {canSeeAll && (
                            <td className="px-2 sm:px-4 py-3 hidden md:table-cell">
                              <EntityTag company={companyById(e.company_id)} />
                            </td>
                          )}
                          <td className="px-2 sm:px-4 py-3 font-mono text-[12px] text-ink-soft hidden sm:table-cell">
                            {g.length}
                          </td>
                          <td className="px-2 sm:px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 sm:w-24 rounded-full bg-line overflow-hidden">
                                <div className="h-full bg-perp" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="font-mono text-[11px] text-ink-soft">{pct}%</span>
                            </div>
                          </td>
                          <td className="px-2 sm:px-4 py-3 font-mono text-[12px] text-ink-soft hidden sm:table-cell">
                            {avgRating ? `${avgRating}/5 · ${rs.length}` : "—"}
                          </td>
                          <td className="px-2 sm:px-4 py-3 font-mono text-[12px] text-ink-soft hidden lg:table-cell">
                            {last ? `${fmtDate(last.review_date)} · ${last.rating}/5` : "—"}
                          </td>
                          <td className="px-2 sm:px-4 py-3 text-right">
                            <button
                              onClick={() => setFocus(e.id)}
                              className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                            >
                              Open
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {!scoped.length && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-ink-soft">
                          No employees in this scope.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <Panel
            title={`Goals · ${focusEmployee?.full_name ?? "you"}`}
            meta={<span className="label-mono">{focusGoals.length} tracked</span>}
          >
            <div className="divide-y divide-line">
              {focusGoals.map((g) => (
                <div key={g.id} className="px-4 py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{g.title}</p>
                      <p className="text-[11px] font-mono text-ink-soft">
                        due {fmtDate(g.target_date)} · weight {g.weight}
                        {g.details ? ` · ${g.details}` : ""}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <StatusPill status={g.status} />
                      <span className="font-mono text-[12px] text-ink-soft">{g.progress}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 mt-2 rounded-full bg-line overflow-hidden">
                    <div className="h-full bg-perp" style={{ width: `${g.progress}%` }} />
                  </div>
                  {canManage && (
                    <div className="mt-2 flex items-center gap-3 flex-wrap">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={g.progress}
                        onChange={(ev) =>
                          updateGoal.mutate({
                            id: g.id,
                            patch: { progress: Number(ev.target.value) },
                          })
                        }
                        className="w-48 accent-black cursor-pointer"
                      />
                      <button
                        onClick={() => updateGoal.mutate({ id: g.id, patch: { status: "achieved", progress: 100 } })}
                        className="h-7 px-2.5 rounded-md bg-brand text-paper text-[11px] font-semibold cursor-pointer hover:bg-brand-deep"
                      >
                        Mark achieved
                      </button>
                      <button
                        onClick={() => updateGoal.mutate({ id: g.id, patch: { status: "missed" } })}
                        className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                      >
                        Missed
                      </button>
                      <button
                        onClick={() => removeGoal.mutate(g.id)}
                        className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium text-destructive cursor-pointer hover:bg-ink/5"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!focusGoals.length && (
                <p className="px-4 py-8 text-center text-[13px] text-ink-soft">
                  No goals set yet.
                </p>
              )}
            </div>
          </Panel>

          <Panel
            title={`Rating history · ${focusEmployee?.full_name ?? "you"}`}
            meta={
              <span className="label-mono">
                {ratingHistory.length
                  ? `avg ${(
                      ratingHistory.reduce((s, r) => s + Number(r.rating), 0) /
                      ratingHistory.length
                    ).toFixed(1)}/5`
                  : "no ratings yet"}
              </span>
            }
          >
            {ratingHistory.length ? (
              <div className="p-4">
                <ol className="relative border-l border-line ml-2 space-y-4">
                  {ratingHistory.map((r, i) => {
                    const prev = i > 0 ? Number(ratingHistory[i - 1]!.rating) : null;
                    const delta = prev === null ? 0 : Number(r.rating) - prev;
                    return (
                      <li key={r.id} className="pl-4 relative">
                        <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-brand" />
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13px] font-medium">{r.period}</p>
                          <span className="font-mono text-[11px] text-ink-soft">
                            {fmtDate(r.review_date)}
                          </span>
                          <span className="ml-auto flex items-center gap-2">
                            <span className="h-1.5 w-24 rounded-full bg-line overflow-hidden">
                              <span
                                className="block h-full bg-brand"
                                style={{ width: `${(Number(r.rating) / 5) * 100}%` }}
                              />
                            </span>
                            <span className="font-mono text-[12px]">{r.rating}/5</span>
                            {delta !== 0 && (
                              <span
                                className={`font-mono text-[11px] ${delta > 0 ? "text-brand-deep" : "text-destructive"}`}
                              >
                                {delta > 0 ? "+" : ""}
                                {delta.toFixed(1)}
                              </span>
                            )}
                          </span>
                        </div>
                        {r.summary && (
                          <p className="mt-1 text-[12px] text-ink-soft">{r.summary}</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-[13px] text-ink-soft">
                No ratings recorded yet.
              </p>
            )}
          </Panel>

          <Panel
            title={`Reviews · ${focusEmployee?.full_name ?? "you"}`}
            meta={<span className="label-mono">{focusReviews.length} on record</span>}
          >
            <div className="divide-y divide-line">
              {focusReviews.map((r) => (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <p className="text-[13px] font-medium">{r.period}</p>
                      <p className="text-[11px] font-mono text-ink-soft">
                        {fmtDate(r.review_date)} · rating {r.rating}/5
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <StatusPill status={r.status === "shared" ? "approved" : "draft"} />
                      {isHr && r.status === "draft" && (
                        <button
                          onClick={() => shareReview.mutate(r.id)}
                          className="h-7 px-2.5 rounded-md bg-brand text-paper text-[11px] font-semibold cursor-pointer hover:bg-brand-deep"
                        >
                          Share
                        </button>
                      )}
                    </div>
                  </div>
                  {(r.summary || r.strengths || r.improvements) && (
                    <div className="mt-2 grid gap-1 text-[12px] text-ink-soft">
                      {r.summary && <p>{r.summary}</p>}
                      {r.strengths && <p>Strengths: {r.strengths}</p>}
                      {r.improvements && <p>To improve: {r.improvements}</p>}
                    </div>
                  )}
                </div>
              ))}
              {!focusReviews.length && (
                <p className="px-4 py-8 text-center text-[13px] text-ink-soft">
                  {canManage ? "No reviews recorded yet." : "No reviews have been shared with you yet."}
                </p>
              )}
            </div>
          </Panel>
        </div>

        {canManage && (
          <aside className="space-y-4">
            <Panel title={isManager ? "Team member in focus" : "Employee in focus"}>
              <div className="p-4">
                <Select
                  label="Employee"
                  value={focusId}
                  onChange={setFocus}
                  options={[
                    ...scoped.map((e) => ({ value: e.id, label: e.full_name })),
                    ...(isManager && myId
                      ? [{ value: myId, label: `${me?.employee?.full_name ?? "Me"} (me)` }]
                      : []),
                  ]}
                />
              </div>
            </Panel>

            <Panel title="Set a goal">
              <div className="p-4 space-y-3">
                <Input
                  label="Goal"
                  value={goalForm.title}
                  onChange={(v) => setGoalForm({ ...goalForm, title: v })}
                />
                <Input
                  label="Details"
                  value={goalForm.details}
                  onChange={(v) => setGoalForm({ ...goalForm, details: v })}
                />
                <Input
                  label="Target date"
                  type="date"
                  value={goalForm.target_date}
                  onChange={(v) => setGoalForm({ ...goalForm, target_date: v })}
                />
                <Input
                  label="Weight"
                  type="number"
                  value={goalForm.weight}
                  onChange={(v) => setGoalForm({ ...goalForm, weight: v })}
                />
                <button
                  disabled={addGoal.isPending || !focusId}
                  onClick={() => addGoal.mutate()}
                  className="w-full h-10 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
                >
                  {addGoal.isPending ? "Saving…" : "Add goal"}
                </button>
              </div>
            </Panel>

            <Panel title={isManager ? "Rate this team member" : "Conduct a review"}>
              <div className="p-4 space-y-3">
                <Combo
                  label="Period"
                  value={reviewForm.period}
                  onChange={(v) => setReviewForm({ ...reviewForm, period: v })}
                  options={periodOptions}
                />
                <Input
                  label="Review date"
                  type="date"
                  value={reviewForm.review_date}
                  onChange={(v) => setReviewForm({ ...reviewForm, review_date: v })}
                />
                <Select
                  label="Overall rating"
                  value={reviewForm.rating}
                  onChange={(v) => setReviewForm({ ...reviewForm, rating: v })}
                  options={["1", "2", "3", "4", "5"].map((n) => ({
                    value: n,
                    label: `${n} / 5`,
                  }))}
                />
                <Input
                  label="Strengths"
                  value={reviewForm.strengths}
                  onChange={(v) => setReviewForm({ ...reviewForm, strengths: v })}
                />
                <Input
                  label="Areas to improve"
                  value={reviewForm.improvements}
                  onChange={(v) => setReviewForm({ ...reviewForm, improvements: v })}
                />
                <Input
                  label="Summary"
                  value={reviewForm.summary}
                  onChange={(v) => setReviewForm({ ...reviewForm, summary: v })}
                />
                {isManager && (
                  <p className="text-[12px] text-ink-soft">
                    Your rating is saved as a draft. HR shares it with the employee.
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    disabled={addReview.isPending || !focusId}
                    onClick={() => addReview.mutate("draft")}
                    className="flex-1 h-10 rounded-md ring-1 ring-line text-[13px] font-medium cursor-pointer hover:bg-ink/5 disabled:opacity-50"
                  >
                    Save draft
                  </button>
                  {isHr && <button
                    disabled={addReview.isPending || !focusId}
                    onClick={() => addReview.mutate("shared")}
                    className="flex-1 h-10 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
                  >
                    Save & share
                  </button>}
                </div>
              </div>
            </Panel>
          </aside>
        )}

        {!canManage && (
          <aside className="space-y-4">
            <Panel title="How this works">
              <div className="p-4 text-[13px] text-ink-soft space-y-2">
                <p>Your manager and HR set your goals and update progress as you deliver.</p>
                <p>Ratings appear here once HR shares the review with you.</p>
              </div>
            </Panel>
          </aside>
        )}
      </div>
    </>
  );
}
