import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, FilterNote, EntityTag, Panel, StatCard, useScope } from "@/components/AppShell";
import { Combo, Input, Select } from "@/routes/_authenticated/employees";
import {
  fmtDate,
  useCandidates,
  useEmployees,
  useInterviews,
  useJobOpenings,
  useMe,
  usePicklists,
  type Candidate,
  type JobOpening,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/recruitment")({
  head: () => ({
    meta: [
      { title: "Hiring — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Post job openings, track candidates through every stage and schedule interviews across all group companies.",
      },
      { property: "og:title", content: "Hiring — AIONOS HR Control Tower" },
      { property: "og:description", content: "Openings, candidates and interviews." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecruitmentPage,
});

function RecruitmentPage() {
  return (
    <AppShell title="Hiring" subtitle="Openings · candidates · interviews">
      <RecruitmentBody />
    </AppShell>
  );
}

const STAGES: Candidate["stage"][] = [
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
];
const STAGE_LABEL: Record<Candidate["stage"], string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Not selected",
};

function RecruitmentBody() {
  const { data: me } = useMe();
  const { companyId, companyById, canSeeAll, companies } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: openings = [] } = useJobOpenings();
  const { data: candidates = [] } = useCandidates();
  const { data: interviews = [] } = useInterviews();
  const queryClient = useQueryClient();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId;
  const targetCompany = companyId ?? me?.hrCompanyId ?? companies[0]?.id ?? "";

  const visibleOpenings = useMemo(
    () => (companyId ? openings.filter((o) => o.company_id === companyId) : openings),
    [openings, companyId],
  );
  const openingIds = new Set(visibleOpenings.map((o) => o.id));
  const visibleCandidates = candidates.filter((c) => openingIds.has(c.job_opening_id));

  const picklists = usePicklists();
  const [tile, setTile] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const activeOpening = visibleOpenings.find((o) => o.id === selected) ?? visibleOpenings[0];
  const activeCandidates = visibleCandidates.filter((c) => c.job_opening_id === activeOpening?.id);

  const [jobForm, setJobForm] = useState({
    title: "",
    department: "",
    location: "",
    hiring_manager_id: "",
    employment_type: "Full time",
    openings: "1",
    description: "",
  });
  const [candForm, setCandForm] = useState({ full_name: "", email: "", source: "Referral" });
  const [ivForm, setIvForm] = useState({
    candidate_id: "",
    scheduled_at: "",
    round_name: "Technical round",
    interviewer: "",
    mode: "Video call",
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["job_openings"] });
    queryClient.invalidateQueries({ queryKey: ["candidates"] });
    queryClient.invalidateQueries({ queryKey: ["interviews"] });
  };

  const addJob = useMutation({
    mutationFn: async () => {
      if (!jobForm.title.trim()) throw new Error("Add a role title");
      if (!targetCompany) throw new Error("Pick a company first");
      const { error } = await supabase.from("job_openings").insert({
        company_id: targetCompany,
        title: jobForm.title.trim(),
        department: jobForm.department,
        location: jobForm.location,
        employment_type: jobForm.employment_type,
        hiring_manager_id: jobForm.hiring_manager_id || null,
        openings: Number(jobForm.openings) || 1,
        description: jobForm.description,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Opening posted");
      setJobForm({ ...jobForm, title: "", description: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setJobStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: JobOpening["status"] }) => {
      const { error } = await supabase.from("job_openings").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const addCandidate = useMutation({
    mutationFn: async () => {
      if (!activeOpening) throw new Error("Post an opening first");
      if (!candForm.full_name.trim()) throw new Error("Add the candidate name");
      const { error } = await supabase.from("candidates").insert({
        job_opening_id: activeOpening.id,
        full_name: candForm.full_name.trim(),
        email: candForm.email.trim(),
        source: candForm.source,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Candidate added");
      setCandForm({ ...candForm, full_name: "", email: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveStage = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: Candidate["stage"] }) => {
      const { error } = await supabase.from("candidates").update({ stage }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const recordOutcome = useMutation({
    mutationFn: async ({
      id,
      outcome,
      feedback,
    }: {
      id: string;
      outcome: string;
      feedback: string;
    }) => {
      const { error } = await supabase.from("interviews").update({ outcome, feedback }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Interview feedback saved");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scheduleInterview = useMutation({
    mutationFn: async () => {
      const candidateId = ivForm.candidate_id || activeCandidates[0]?.id;
      if (!candidateId) throw new Error("Add a candidate first");
      if (!ivForm.scheduled_at) throw new Error("Pick a date and time");
      const { error } = await supabase.from("interviews").insert({
        candidate_id: candidateId,
        scheduled_at: new Date(ivForm.scheduled_at).toISOString(),
        round_name: ivForm.round_name,
        interviewer: ivForm.interviewer,
        mode: ivForm.mode,
      });
      if (error) throw error;
      await supabase.from("candidates").update({ stage: "interview" }).eq("id", candidateId);
    },
    onSuccess: () => {
      toast.success("Interview scheduled");
      setIvForm({ ...ivForm, scheduled_at: "", interviewer: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isHr) {
    return (
      <Panel title="Hiring">
        <p className="px-4 py-10 text-center text-[13px] text-ink-soft">
          Hiring is handled by your HR team.
        </p>
      </Panel>
    );
  }

  const myInterviews = interviews
    .filter((i) => visibleCandidates.some((c) => c.id === i.candidate_id))
    .sort((a, b) => (a.scheduled_at < b.scheduled_at ? 1 : -1))
    .slice(0, 12);

  const toggle = (k: string) => setTile((prev) => (prev === k ? null : k));
  const shownOpenings =
    tile === "open" ? visibleOpenings.filter((o) => o.status === "open") : visibleOpenings;
  const shownCandidates =
    tile === "interview" || tile === "hired"
      ? activeCandidates.filter((c) => c.stage === tile)
      : activeCandidates;

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Open roles"
          value={visibleOpenings.filter((o) => o.status === "open").length}
          hint={`${visibleOpenings.reduce((s, o) => s + o.openings, 0)} positions`}
          onClick={() => toggle("open")}
          active={tile === "open"}
        />
        <StatCard
          label="Candidates"
          value={visibleCandidates.length}
          hint="in pipeline"
          onClick={() => setTile(null)}
          active={tile === null}
        />
        <StatCard
          label="In interview"
          value={visibleCandidates.filter((c) => c.stage === "interview").length}
          hintTone="warn"
          onClick={() => toggle("interview")}
          active={tile === "interview"}
        />
        <StatCard
          label="Hired"
          value={visibleCandidates.filter((c) => c.stage === "hired").length}
          hintTone="good"
          onClick={() => toggle("hired")}
          active={tile === "hired"}
        />
      </section>
      {tile && (
        <FilterNote
          label={tile === "open" ? "open roles" : tile}
          count={tile === "open" ? shownOpenings.length : shownCandidates.length}
          onClear={() => setTile(null)}
        />
      )}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Panel title={`Openings · ${shownOpenings.length}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-mono border-b border-line">
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    {canSeeAll && <th className="px-4 py-2.5 font-medium">Entity</th>}
                    <th className="px-4 py-2.5 font-medium">Location</th>
                    <th className="px-4 py-2.5 font-medium">Pipeline</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shownOpenings.map((o) => (
                    <tr
                      key={o.id}
                      className={`hover:bg-ink/[0.03] ${activeOpening?.id === o.id ? "bg-ink/[0.04]" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{o.title}</p>
                        <p className="text-[11px] font-mono text-ink-soft">
                          {o.department} · {o.openings} opening{o.openings > 1 ? "s" : ""}
                        </p>
                      </td>
                      {canSeeAll && (
                        <td className="px-4 py-3">
                          <EntityTag company={companyById(o.company_id)} />
                        </td>
                      )}
                      <td className="px-4 py-3 text-ink-soft">{o.location}</td>
                      <td className="px-4 py-3 font-mono text-[12px]">
                        {candidates.filter((c) => c.job_opening_id === o.id).length}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={o.status}
                          onChange={(e) => setJobStatus.mutate({ id: o.id, status: e.target.value as JobOpening["status"] })}
                          className="h-7 px-1.5 rounded-md bg-paper ring-1 ring-line text-[11px] cursor-pointer"
                        >
                          <option value="open">Open</option>
                          <option value="on_hold">On hold</option>
                          <option value="closed">Closed</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setSelected(o.id)}
                          className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!shownOpenings.length && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                        No openings posted yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {activeOpening && (
            <Panel
              title={`Pipeline · ${activeOpening.title}`}
              meta={<span className="label-mono">{shownCandidates.length} candidates</span>}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left label-mono border-b border-line">
                      <th className="px-4 py-2.5 font-medium">Candidate</th>
                      <th className="px-4 py-2.5 font-medium">Source</th>
                      <th className="px-4 py-2.5 font-medium">Applied</th>
                      <th className="px-4 py-2.5 font-medium">Stage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shownCandidates.map((c) => (
                      <tr key={c.id} className="hover:bg-ink/[0.03]">
                        <td className="px-4 py-3">
                          <p className="font-medium">{c.full_name}</p>
                          <p className="text-[11px] font-mono text-ink-soft">{c.email}</p>
                        </td>
                        <td className="px-4 py-3 text-ink-soft">{c.source}</td>
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                          {fmtDate(c.applied_on)}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={c.stage}
                            onChange={(e) => moveStage.mutate({ id: c.id, stage: e.target.value as Candidate["stage"] })}
                            className="h-7 px-1.5 rounded-md bg-paper ring-1 ring-line text-[11px] cursor-pointer"
                          >
                            {STAGES.map((s) => (
                              <option key={s} value={s}>
                                {STAGE_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                    {!shownCandidates.length && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-ink-soft">
                          No candidates yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t border-line grid sm:grid-cols-4 gap-2 items-end">
                <Input
                  label="Candidate name"
                  value={candForm.full_name}
                  onChange={(v) => setCandForm({ ...candForm, full_name: v })}
                />
                <Input
                  label="Email"
                  value={candForm.email}
                  onChange={(v) => setCandForm({ ...candForm, email: v })}
                />
                <Select
                  label="Source"
                  value={candForm.source}
                  onChange={(v) => setCandForm({ ...candForm, source: v })}
                  options={["Referral", "Careers page", "Job board", "Agency", "LinkedIn"].map(
                    (s) => ({ value: s, label: s }),
                  )}
                />
                <button
                  onClick={() => addCandidate.mutate()}
                  className="h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                >
                  Add candidate
                </button>
              </div>
            </Panel>
          )}
        </div>

        <aside className="space-y-4">
          <Panel title="Post an opening">
            <div className="p-4 space-y-3">
              <Combo
                label="Role title"
                value={jobForm.title}
                onChange={(v) => setJobForm({ ...jobForm, title: v })}
                options={picklists.job_title}
              />
              <Combo
                label="Department"
                value={jobForm.department}
                onChange={(v) => setJobForm({ ...jobForm, department: v })}
                options={picklists.department}
              />
              <Combo
                label="Location"
                value={jobForm.location}
                onChange={(v) => setJobForm({ ...jobForm, location: v })}
                options={picklists.location}
              />
              <Select
                label="Type"
                value={jobForm.employment_type}
                onChange={(v) => setJobForm({ ...jobForm, employment_type: v })}
                options={["Full time", "Contract", "Intern"].map((s) => ({ value: s, label: s }))}
              />
              <Select
                label="Hiring manager"
                value={jobForm.hiring_manager_id}
                onChange={(v) => setJobForm({ ...jobForm, hiring_manager_id: v })}
                options={[
                  { value: "", label: "Not assigned" },
                  ...employees
                    .filter((e) => e.company_id === targetCompany && e.status !== "offboarded")
                    .map((e) => ({ value: e.id, label: `${e.full_name} · ${e.job_title}` })),
                ]}
              />
              <Input
                label="Number of positions"
                type="number"
                value={jobForm.openings}
                onChange={(v) => setJobForm({ ...jobForm, openings: v })}
              />
              <div>
                <p className="label-mono mb-1">About the role</p>
                <textarea
                  value={jobForm.description}
                  onChange={(e) => setJobForm({ ...jobForm, description: e.target.value })}
                  rows={3}
                  className="w-full p-2 rounded-md bg-paper ring-1 ring-line text-[13px] outline-none focus:ring-ink"
                />
              </div>
              <button
                onClick={() => addJob.mutate()}
                className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
              >
                Post opening
              </button>
            </div>
          </Panel>

          <Panel title="Schedule an interview">
            <div className="p-4 space-y-3">
              <Select
                label="Candidate"
                value={ivForm.candidate_id || (activeCandidates[0]?.id ?? "")}
                onChange={(v) => setIvForm({ ...ivForm, candidate_id: v })}
                options={activeCandidates.map((c) => ({ value: c.id, label: c.full_name }))}
              />
              <Input
                label="Date and time"
                type="datetime-local"
                value={ivForm.scheduled_at}
                onChange={(v) => setIvForm({ ...ivForm, scheduled_at: v })}
              />
              <Input
                label="Round"
                value={ivForm.round_name}
                onChange={(v) => setIvForm({ ...ivForm, round_name: v })}
              />
              <Select
                label="Interviewer"
                value={ivForm.interviewer}
                onChange={(v) => setIvForm({ ...ivForm, interviewer: v })}
                options={[
                  { value: "", label: "Select" },
                  ...[
                    ...new Set(
                      employees
                        .filter((e) => !companyId || e.company_id === companyId)
                        .map((e) => e.full_name),
                    ),
                  ].map((n) => ({ value: n, label: n })),
                ]}
              />
              <button
                onClick={() => scheduleInterview.mutate()}
                className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
              >
                Schedule
              </button>
            </div>
          </Panel>

          <Panel title="Interview schedule">
            <div className="divide-y divide-line">
              {myInterviews.map((i) => (
                <div key={i.id} className="px-4 py-3 space-y-2">
                  <p className="text-[13px] font-medium">
                    {candidates.find((c) => c.id === i.candidate_id)?.full_name ?? "—"}
                  </p>
                  <p className="text-[11px] font-mono text-ink-soft">
                    {new Date(i.scheduled_at).toLocaleString()} · {i.round_name}
                    {i.interviewer ? ` · ${i.interviewer}` : ""}
                  </p>
                  <div className="flex gap-2">
                    <select
                      value={i.outcome || ""}
                      onChange={(e) =>
                        recordOutcome.mutate({
                          id: i.id,
                          outcome: e.target.value,
                          feedback: i.feedback ?? "",
                        })
                      }
                      className="h-7 px-1.5 rounded-md bg-paper ring-1 ring-line text-[11px] cursor-pointer"
                    >
                      <option value="">Awaiting feedback</option>
                      <option value="Selected">Selected</option>
                      <option value="On hold">On hold</option>
                      <option value="Not selected">Not selected</option>
                    </select>
                    <input
                      defaultValue={i.feedback ?? ""}
                      placeholder="Feedback note"
                      onBlur={(e) => {
                        if (e.target.value !== (i.feedback ?? ""))
                          recordOutcome.mutate({
                            id: i.id,
                            outcome: i.outcome ?? "",
                            feedback: e.target.value,
                          });
                      }}
                      className="flex-1 min-w-0 h-7 px-2 rounded-md bg-paper ring-1 ring-line text-[12px] outline-none focus:ring-ink"
                    />
                  </div>
                </div>
              ))}
              {!myInterviews.length && (
                <p className="px-4 py-6 text-center text-[12px] text-ink-soft">
                  Nothing scheduled yet.
                </p>
              )}
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
