import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, MessageCircle, RefreshCw, Send, Video } from "lucide-react";
import { Panel } from "@/components/AppShell";
import {
  disconnectChannel,
  getMyChannels,
  getWhatsappThread,
  sendWhatsappChat,
  startWhatsappLink,
} from "@/lib/channels.functions";
import type { ChatTurn, WhatsappInvite } from "@/lib/channels.functions";
import { decideChatApproval, getChatApprovals } from "@/lib/approvals.functions";
import type { ChatApproval } from "@/lib/approvals.functions";
import { completeTeamsConnection, startTeamsConnect, syncTeamsChat } from "@/lib/teams.functions";
import { completeOutlookConnection, startOutlookConnect } from "@/lib/outlook.functions";

/** Approve or send back leave and timesheets without leaving the chat. */
function ApprovalStrip() {
  const listFn = useServerFn(getChatApprovals);
  const decideFn = useServerFn(decideChatApproval);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState("");

  const { data = [] } = useQuery({
    queryKey: ["chat_approvals"],
    queryFn: () => listFn({}) as Promise<ChatApproval[]>,
  });

  const decide = useMutation({
    mutationFn: async (v: { item: ChatApproval; decision: "approved" | "rejected" }) =>
      (await decideFn({
        data: { kind: v.item.kind, id: v.item.id, decision: v.decision },
      })) as { message: string },
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["chat_approvals"] });
      queryClient.invalidateQueries({ queryKey: ["leave_requests"] });
      queryClient.invalidateQueries({ queryKey: ["timesheets"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusy(""),
  });

  if (!data.length) return null;

  return (
    <div className="border-b border-line bg-brand/[0.05] px-3 py-2 space-y-2">
      <p className="text-[11.5px] font-semibold text-brand-deep">
        Waiting for you · {data.length}
      </p>
      {data.slice(0, 5).map((item) => (
        <div
          key={`${item.kind}-${item.id}`}
          className="flex flex-wrap items-center gap-2 rounded-lg bg-paper ring-1 ring-line px-2.5 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium truncate">
              {item.employeeName} · {item.headline}
            </p>
            <p className="text-[11px] font-mono text-ink-soft truncate">{item.detail}</p>
          </div>
          <button
            disabled={busy === item.id}
            onClick={() => {
              setBusy(item.id);
              decide.mutate({ item, decision: "approved" });
            }}
            className="h-7 px-2.5 rounded-md bg-brand text-paper text-[11.5px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
          >
            Approve
          </button>
          <button
            disabled={busy === item.id}
            onClick={() => {
              setBusy(item.id);
              decide.mutate({ item, decision: "rejected" });
            }}
            className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11.5px] font-medium cursor-pointer hover:bg-ink/5 disabled:opacity-50"
          >
            Send back
          </button>
        </div>
      ))}
    </div>
  );
}

function waitForConnectorCode(popup: Window, connectorId: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (
        event.origin !== window.location.origin ||
        event.data?.connectorId !== connectorId ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      )
        return;
      cleanup();
      if (type === "appUserConnectorOAuthComplete") {
        resolve(typeof event.data?.code === "string" ? event.data.code : null);
        return;
      }
      popup.close();
      reject(new Error("Microsoft sign-in did not complete."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("The sign-in window was closed."));
      }
    }, 500);
  });
}


const STARTERS = [
  "How many leave days do I have left?",
  "Apply for leave next Monday and Tuesday",
  "Log 8 hours today on client delivery",
  "How am I doing against my goals?",
];

/** The same conversation the assistant has on WhatsApp, usable right here. */
function AssistantThread() {
  const threadFn = useServerFn(getWhatsappThread);
  const sendFn = useServerFn(sendWhatsappChat);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<ChatTurn[] | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery({
    queryKey: ["whatsapp_thread"],
    queryFn: () => threadFn({}) as Promise<ChatTurn[]>,
  });

  useEffect(() => {
    if (data && turns === null) setTurns(data);
  }, [data, turns]);

  const shown = turns ?? data ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [shown.length]);

  const send = useMutation({
    mutationFn: async (text: string) => (await sendFn({ data: { text } })) as { reply: string },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (text: string) => {
    const value = text.trim();
    if (!value || send.isPending) return;
    setDraft("");
    const at = new Date().toISOString();
    setTurns([...shown, { role: "user", content: value, at }]);
    send.mutate(value, {
      onSuccess: (res) =>
        setTurns((prev) => [
          ...(prev ?? []),
          { role: "assistant", content: res.reply, at: new Date().toISOString() },
        ]),
    });
  };

  return (
    <div className="rounded-xl ring-1 ring-line overflow-hidden">
      <div className="px-3 py-2 bg-ink/[0.03] border-b border-line">
        <p className="text-[12.5px] font-semibold">Chat now</p>
        <p className="text-[11.5px] text-ink-soft">
          Same conversation you get on WhatsApp — leave, timesheets and your goals.
        </p>
      </div>
      <ApprovalStrip />
      <div className="max-h-80 overflow-y-auto p-3 space-y-2 bg-paper">
        {!shown.length && (
          <div className="space-y-2">
            <p className="text-[12.5px] text-ink-soft">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="h-7 px-2.5 rounded-full ring-1 ring-line text-[11.5px] cursor-pointer hover:bg-ink/5"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {shown.map((m, i) => (
          <div
            key={`${m.at}-${i}`}
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] whitespace-pre-wrap ${
              m.role === "user"
                ? "ml-auto bg-brand text-paper rounded-br-sm"
                : "bg-ink/[0.05] rounded-bl-sm"
            }`}
          >
            {m.content}
          </div>
        ))}
        {send.isPending && (
          <div className="bg-ink/[0.05] rounded-2xl rounded-bl-sm px-3 py-2 text-[12.5px] text-ink-soft w-fit">
            Typing…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="flex items-center gap-2 border-t border-line p-2"
      >
        <label className="sr-only" htmlFor="assistant-message">
          Message the HR assistant
        </label>
        <input
          id="assistant-message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about leave, timesheets or your goals…"
          className="flex-1 h-9 px-3 rounded-md ring-1 ring-line bg-paper text-[13px] outline-none focus:ring-brand"
        />
        <button
          type="submit"
          disabled={send.isPending || !draft.trim()}
          className="h-9 px-3 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <Send className="size-3.5" /> Send
        </button>
      </form>
    </div>
  );
}

export function ChannelPanel() {
  const queryClient = useQueryClient();
  const channelsFn = useServerFn(getMyChannels);
  const startWhatsapp = useServerFn(startWhatsappLink);
  const disconnect = useServerFn(disconnectChannel);
  const startTeams = useServerFn(startTeamsConnect);
  const completeTeams = useServerFn(completeTeamsConnection);
  const startOutlook = useServerFn(startOutlookConnect);
  const completeOutlook = useServerFn(completeOutlookConnection);
  const syncTeams = useServerFn(syncTeamsChat);
  const [invite, setInvite] = useState<WhatsappInvite | null>(null);

  const { data } = useQuery({
    queryKey: ["my_channels"],
    queryFn: () => channelsFn({}),
  });

  const whatsapp = data?.channels.find((c) => c.channel === "whatsapp");
  const teams = data?.channels.find((c) => c.channel === "microsoft_teams");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["my_channels"] });

  const makeInvite = useMutation({
    mutationFn: async () => (await startWhatsapp({})) as WhatsappInvite,
    onSuccess: (res) => {
      setInvite(res);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const drop = useMutation({
    mutationFn: async (channel: "whatsapp" | "microsoft_teams") =>
      disconnect({ data: { channel } }),
    onSuccess: () => {
      setInvite(null);
      toast.success("Disconnected");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const connectTeams = useMutation({
    mutationFn: async () => {
      const popup = window.open("", "teams-oauth", "width=600,height=720");
      if (!popup) throw new Error("Allow pop-ups for this site, then try again.");
      try {
        const { authorizationUrl } = (await startTeams({})) as { authorizationUrl: string };
        const waiting = waitForConnectorCode(popup, "microsoft_teams");
        popup.location.href = authorizationUrl;
        const code = await waiting;
        if (code) await completeTeams({ data: { code } });
      } catch (error) {
        popup.close();
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Microsoft Teams connected");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const connectOutlook = useMutation({
    mutationFn: async () => {
      const popup = window.open("", "outlook-oauth", "width=600,height=720");
      if (!popup) throw new Error("Allow pop-ups for this site, then try again.");
      try {
        const { authorizationUrl } = (await startOutlook({})) as { authorizationUrl: string };
        const waiting = waitForConnectorCode(popup, "microsoft_outlook");
        popup.location.href = authorizationUrl;
        const code = await waiting;
        if (code) await completeOutlook({ data: { code } });
      } catch (error) {
        popup.close();
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Outlook connected");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: async () => (await syncTeams({})) as { answered: number },
    onSuccess: (res) => {
      toast.success(
        res.answered ? `Replied to ${res.answered} Teams message(s)` : "No new Teams messages",
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const noPhone = !data?.phone?.trim();

  return (
    <Panel title="Chat with the HR assistant">
      <div className="p-4 space-y-5">
        <p className="text-[13px] text-ink-soft">
          Connect a chat app and you can check leave, apply for leave and fill in your timesheet by
          messaging the assistant — the same things you can do here.
        </p>

        {/* WhatsApp */}
        <div className="rounded-xl ring-1 ring-line p-3 space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="size-4 text-brand" />
            <p className="text-[13px] font-semibold">WhatsApp</p>
            {whatsapp?.status === "connected" && (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-brand-deep">
                <CheckCircle2 className="size-3.5" /> Connected {whatsapp.handle}
              </span>
            )}
          </div>

          {noPhone && (
            <p className="text-[12.5px] text-ink-soft">
              Add your phone number above and save it, so replies can also reach you on WhatsApp.
            </p>
          )}

          {whatsapp?.status !== "connected" && (
            <>
              <button
                disabled={makeInvite.isPending}
                onClick={() => makeInvite.mutate()}
                className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
              >
                {makeInvite.isPending ? "Preparing…" : invite ? "New QR code" : "Show my QR code"}
              </button>

              {invite && (
                <div className="flex flex-col sm:flex-row gap-4 items-start pt-1">
                  <img
                    src={invite.qrDataUrl}
                    alt="QR code that opens a chat with the HR assistant"
                    className="size-40 rounded-lg ring-1 ring-line bg-paper"
                  />
                  <div className="space-y-2 text-[12.5px]">
                    <p>
                      Scan this with your phone camera to open the chat — ask for leave, fill in your
                      timesheet or check your rating.
                    </p>
                    <p className="font-mono text-[15px] tracking-widest text-brand-deep">
                      JOIN {invite.code}
                    </p>
                    {!invite.ready && (
                      <p className="text-ink-soft">
                        The company WhatsApp number is not switched on yet, so this code opens the
                        chat below on your phone in the meantime.
                      </p>
                    )}
                    <p className="text-ink-soft">The code expires in 30 minutes.</p>
                  </div>
                </div>
              )}
            </>
          )}

          <div id="assistant" className="scroll-mt-24">
            <AssistantThread />
          </div>

          {whatsapp?.status === "connected" && (
            <button
              onClick={() => drop.mutate("whatsapp")}
              className="h-9 px-4 rounded-md ring-1 ring-line text-[13px] font-medium cursor-pointer hover:bg-ink/5"
            >
              Disconnect WhatsApp
            </button>
          )}
        </div>

        {/* Microsoft Teams */}
        <div className="rounded-xl ring-1 ring-line p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Video className="size-4 text-brand" />
            <p className="text-[13px] font-semibold">Microsoft Teams</p>
            {teams?.status === "connected" && (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-brand-deep">
                <CheckCircle2 className="size-3.5" /> Connected
              </span>
            )}
          </div>

          {teams?.status === "connected" ? (
            <div className="space-y-2">
              <p className="text-[12.5px] text-ink-soft">
                Write to yourself in Teams (the “You” chat), then bring the answers back here.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={sync.isPending}
                  onClick={() => sync.mutate()}
                  className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <RefreshCw className={`size-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
                  {sync.isPending ? "Checking…" : "Check Teams now"}
                </button>
                <button
                  onClick={() => drop.mutate("microsoft_teams")}
                  className="h-9 px-4 rounded-md ring-1 ring-line text-[13px] font-medium cursor-pointer hover:bg-ink/5"
                >
                  Disconnect Teams
                </button>
              </div>
            </div>
          ) : data && !data.teamsReady ? (
            <p className="text-[12.5px] text-ink-soft">
              Microsoft Teams is not switched on for the company yet. Once it is, you can connect
              your own Microsoft account here.
            </p>
          ) : (
            <button
              disabled={connectTeams.isPending}
              onClick={() => connectTeams.mutate()}
              className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
            >
              {connectTeams.isPending ? "Opening Microsoft…" : "Connect Microsoft Teams"}
            </button>
          )}
        </div>

        <div className="rounded-xl ring-1 ring-line p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Send className="size-4 text-brand" />
            <p className="text-[13px] font-semibold">Outlook approval cards</p>
            {data?.outlookConnected && (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-brand-deep">
                <CheckCircle2 className="size-3.5" /> Connected
              </span>
            )}
          </div>
          {data?.outlookConnected ? (
            <p className="text-[12.5px] text-ink-soft">
              Approval cards will be sent to this mailbox when leave, timesheets, or expenses need your decision.
            </p>
          ) : data && !data.outlookReady ? (
            <p className="text-[12.5px] text-ink-soft">Outlook cards are not switched on for this app yet.</p>
          ) : (
            <button
              disabled={connectOutlook.isPending}
              onClick={() => connectOutlook.mutate()}
              className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
            >
              {connectOutlook.isPending ? "Opening Microsoft…" : "Connect Outlook"}
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}
