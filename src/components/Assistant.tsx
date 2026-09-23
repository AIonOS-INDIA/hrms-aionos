import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Search, Send, Sparkles, X } from "lucide-react";
import { askAssistant } from "@/lib/assistant.functions";
import { useMe } from "@/lib/hrms";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "How many leave days do I have left?",
  "Apply annual leave next Monday to Wednesday",
  "Log 8 hours today: 5h client delivery, 3h internal review",
  "Show my goals and latest performance review",
  "Start an expense claim for my Delhi client trip",
  "What does the travel policy say about hotel limits?",
  "Which training courses am I enrolled in?",
  "Show my payslip and salary details",
];

export function Assistant() {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const queryClient = useQueryClient();
  const ask = useServerFn(askAssistant);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const next: Msg[] = [...messages, { role: "user", content: text }];
      setMessages(next);
      const res = (await ask({ data: { messages: next } })) as {
        reply: string;
        actions: string[];
      };
      return res;
    },
    onSuccess: (res) => {
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
      if (res.actions?.length) {
        queryClient.invalidateQueries({ queryKey: ["leave_requests"] });
        queryClient.invalidateQueries({ queryKey: ["leave_balances"] });
        queryClient.invalidateQueries({ queryKey: ["timesheets"] });
        queryClient.invalidateQueries({ queryKey: ["timesheet_entries"] });
      }
    },
    onError: (e: Error) => {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: e.message || "Something went wrong. Please try again." },
      ]);
    },
  });

  function submit(text: string) {
    const value = text.trim();
    if (!value || send.isPending) return;
    setInput("");
    send.mutate(value);
  }

  if (!me) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Ask HR AI"
        className="w-full h-10 px-3 rounded-full inline-flex items-center gap-2.5 bg-paper ring-1 ring-brand/25 hover:ring-brand/45 hover:bg-brand/5 shadow-sm cursor-pointer transition-colors"
      >
        <Search className="size-4 text-brand shrink-0" />
        <span className="text-[13px] text-ink-soft truncate">
          Ask anything — leave, timesheets, expenses, payroll, performance…
        </span>
        <span className="ml-auto hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-ink-soft ring-1 ring-line rounded-md px-1.5 py-0.5">
          ⌘K
        </span>
        <Sparkles className="size-3.5 text-brand shrink-0 sm:hidden" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6">
          <button
            aria-label="Close assistant"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
          />
          <div className="relative mt-[6vh] w-full max-w-2xl h-[72vh] flex flex-col bg-panel ring-1 ring-black/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="h-14 shrink-0 flex items-center gap-2.5 px-4 border-b border-line bg-[linear-gradient(100deg,var(--color-brand-deep),var(--color-brand))] text-paper">
              <Bot className="size-4" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-none">HR AI assistant</p>
                <p className="text-[11px] font-mono opacity-80 mt-1">
                  Your whole HR workspace, in one chat
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                className="ml-auto size-8 grid place-items-center rounded-lg hover:bg-paper/15 cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-[13px] text-ink-soft">
                    Ask in plain language. I can help with leave and holidays, timesheets,
                    expenses and reimbursements, payslips and salary, goals and reviews, learning,
                    benefits, company policies, and your own profile — and I can make the changes
                    for you, not just look things up. If you approve leave, timesheets, expenses or
                    payments, you can action those here too.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => submit(s)}
                        className="text-left text-[12.5px] px-3 py-2 rounded-xl ring-1 ring-line hover:bg-brand/8 cursor-pointer"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[88%] px-3 py-2 rounded-2xl text-[13px] whitespace-pre-wrap leading-relaxed ${
                    m.role === "user"
                      ? "ml-auto bg-brand/12 text-brand-deep rounded-br-sm"
                      : "bg-ink/[0.04] rounded-bl-sm"
                  }`}
                >
                  {m.content}
                </div>
              ))}

              {send.isPending && (
                <div className="bg-ink/[0.04] w-fit px-3 py-2 rounded-2xl rounded-bl-sm text-[13px] text-ink-soft">
                  Working on it…
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="shrink-0 border-t border-line p-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit(input);
                    }
                  }}
                  placeholder="Ask or tell me what to do…"
                  aria-label="Message the HR assistant"
                  className="flex-1 resize-none max-h-28 rounded-xl ring-1 ring-line px-3 py-2 text-[13px] outline-none focus:ring-brand/50 bg-paper"
                />
                <button
                  onClick={() => submit(input)}
                  disabled={send.isPending || !input.trim()}
                  aria-label="Send"
                  className="size-9 shrink-0 grid place-items-center rounded-xl text-paper cursor-pointer disabled:opacity-40 bg-[linear-gradient(100deg,var(--color-brand-deep),var(--color-brand))]"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
