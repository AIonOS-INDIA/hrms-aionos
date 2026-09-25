import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";

/** Full-screen friendly selfie capture. Returns a compressed JPEG data URL. */
export function CameraCapture({
  title,
  busy,
  onCapture,
  onClose,
}: {
  title: string;
  busy?: boolean;
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: 640 } })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setErr("Camera blocked. Allow camera access in your browser to continue."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    const w = 480;
    c.width = w;
    c.height = Math.round((v.videoHeight / v.videoWidth) * w);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    onCapture(c.toDataURL("image/jpeg", 0.8));
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-3">
      <div className="w-full max-w-sm bg-panel rounded-2xl ring-1 ring-line overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <p className="text-[14px] font-semibold">{title}</p>
          <button onClick={onClose} aria-label="Close" className="cursor-pointer">
            <X className="size-4" />
          </button>
        </div>
        <div className="relative aspect-[3/4] bg-line/40">
          {err ? (
            <p className="p-6 text-[13px] text-destructive">{err}</p>
          ) : (
            <video ref={video} autoPlay playsInline muted className="size-full object-cover -scale-x-100" />
          )}
          <div className="pointer-events-none absolute inset-[18%_14%] rounded-[50%] ring-2 ring-paper/80" />
        </div>
        <div className="p-4">
          <p className="text-[12px] text-ink-soft mb-3">Keep your face inside the oval, in good light.</p>
          <button
            onClick={snap}
            disabled={!!err || busy}
            className="w-full h-12 rounded-xl bg-brand text-paper font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <Camera className="size-4" /> {busy ? "Checking…" : "Capture"}
          </button>
        </div>
      </div>
    </div>
  );
}
