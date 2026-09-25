import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Note = {
  id: string;
  title: string;
  body: string;
  link: string;
  read_at: string | null;
  created_at: string;
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { data: notes = [] } = useQuery({
    queryKey: ["notifications"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications" as never)
        .select("id, title, body, link, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as Note[];
    },
  });
  const unread = notes.filter((n) => !n.read_at);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const markAll = async () => {
    if (!unread.length) return;
    await supabase
      .from("notifications" as never)
      .update({ read_at: new Date().toISOString() } as never)
      .in("id", unread.map((n) => n.id));
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative size-9 grid place-items-center rounded-xl ring-1 ring-line hover:bg-ink/5 cursor-pointer"
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {unread.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-brand text-paper text-[10px] font-semibold grid place-items-center">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(22rem,90vw)] max-h-[70vh] overflow-auto rounded-xl bg-paper ring-1 ring-line shadow-lg z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line">
            <p className="text-[13px] font-semibold">Notifications</p>
            <button onClick={markAll} className="text-[11px] text-brand cursor-pointer hover:underline">
              Mark all read
            </button>
          </div>
          {notes.length === 0 ? (
            <p className="p-4 text-[12.5px] text-ink-soft">Nothing new.</p>
          ) : (
            notes.map((n) => (
              <Link
                key={n.id}
                to={(n.link || "/dashboard") as "/dashboard"}
                onClick={() => setOpen(false)}
                className={`block px-3 py-2.5 border-b border-line last:border-0 hover:bg-brand/5 ${n.read_at ? "" : "bg-brand/[0.04]"}`}
              >
                <p className="text-[12.5px] font-medium">{n.title}</p>
                <p className="text-[12px] text-ink-soft mt-0.5">{n.body}</p>
                <p className="label-mono mt-1">{new Date(n.created_at).toLocaleString()}</p>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
