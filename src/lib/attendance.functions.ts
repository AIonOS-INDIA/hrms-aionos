import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Selfie = z.string().startsWith("data:image/").max(3_000_000);

function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function todayIST() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

async function uploadSelfie(admin: any, employeeId: string, dataUrl: string, name: string) {
  const [meta = "", b64 = ""] = dataUrl.split(",");
  const type = meta.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const path = `${employeeId}/${name}`;
  const { error } = await admin.storage.from("attendance-photos").upload(path, bytes, { contentType: type, upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

async function faceMatch(reference: string, probe: string): Promise<{ match: boolean; confidence: number; reason: string }> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("Face check is not available right now");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-3.8-flash",
      messages: [
        {
          role: "system",
          content:
            'You verify attendance selfies. Compare the face in image 1 (enrolled) with image 2 (live). Reject if image 2 has no clear real face, shows a photo of a screen/printout, or is a different person. Reply ONLY JSON: {"match":boolean,"confidence":0-1,"reason":"short"}',
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Image 1: enrolled. Image 2: live punch." },
            { type: "image_url", image_url: { url: reference } },
            { type: "image_url", image_url: { url: probe } },
          ],
        },
      ],
    }),
  });
  if (res.status === 429) throw new Error("Face check is busy — try again in a moment");
  if (res.status === 402) throw new Error("AI credits have run out — ask HR to top up");
  if (!res.ok) throw new Error("Face check failed");
  const j = await res.json();
  const txt: string = j.choices?.[0]?.message?.content ?? "";
  try {
    const p = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
    return { match: !!p.match, confidence: Number(p.confidence) || 0, reason: String(p.reason ?? "") };
  } catch {
    return { match: false, confidence: 0, reason: "Could not read the face check" };
  }
}

async function myContext(context: any) {
  const { data: emp } = await context.supabase
    .from("employees")
    .select("id, company_id, full_name")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (!emp) throw new Error("Your employee record is not linked yet");
  const { data: s } = await context.supabase
    .from("attendance_settings")
    .select("*")
    .eq("company_id", emp.company_id)
    .maybeSingle();
  return { emp, s: s ?? { geofence_required: true, face_required: true } };
}

/** Register the reference face used for every future punch (once; HR can reset). */
export const enrollFace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ selfie: Selfie }).parse(d))
  .handler(async ({ context, data }) => {
    const { emp } = await myContext(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("employee_face_profiles" as never)
      .select("employee_id")
      .eq("employee_id", emp.id)
      .maybeSingle();
    if (existing) throw new Error("Your face is already registered. Ask HR to reset it.");
    const path = await uploadSelfie(supabaseAdmin, emp.id, data.selfie, "face-profile.jpg");
    await supabaseAdmin.from("employee_face_profiles" as never).insert({ employee_id: emp.id, photo_path: path } as never);
    return { ok: true };
  });

export const punch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: z.enum(["in", "out"]),
        lat: z.number().nullable(),
        lng: z.number().nullable(),
        selfie: Selfie.nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { emp, s } = await myContext(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    // Geo-fence
    let locationId: string | null = null;
    let locationName = "";
    const { data: locs } = await admin
      .from("office_locations")
      .select("id, name, lat, lng, radius_m")
      .eq("company_id", emp.company_id)
      .eq("active", true);
    if (s.geofence_required && (locs ?? []).length) {
      if (data.lat == null || data.lng == null) throw new Error("Turn on location to punch");
      const near = (locs as any[])
        .map((l) => ({ ...l, d: metres(data.lat!, data.lng!, l.lat, l.lng) }))
        .sort((a, b) => a.d - b.d)[0];
      if (near.d > near.radius_m)
        throw new Error(`You are ${Math.round(near.d)} m from ${near.name}. Punch is allowed within ${near.radius_m} m.`);
      locationId = near.id;
      locationName = near.name;
    }

    // Face match
    let score: number | null = null;
    let selfiePath = "";
    if (s.face_required) {
      if (!data.selfie) throw new Error("A selfie is needed to punch");
      const { data: prof } = await admin.from("employee_face_profiles").select("photo_path").eq("employee_id", emp.id).maybeSingle();
      if (!prof) throw new Error("Register your face first");
      const { data: ref } = await admin.storage.from("attendance-photos").createSignedUrl(prof.photo_path, 120);
      const result = await faceMatch(ref.signedUrl, data.selfie);
      score = result.confidence;
      if (!result.match || result.confidence < 0.6) throw new Error(`Face not recognised — ${result.reason || "try again in good light"}`);
    }

    const day = todayIST();
    if (data.selfie) selfiePath = await uploadSelfie(admin, emp.id, data.selfie, `${day}-${data.kind}.jpg`);
    const now = new Date().toISOString();
    const { data: existing } = await admin
      .from("attendance_days")
      .select("id, in_at, out_at")
      .eq("employee_id", emp.id)
      .eq("work_date", day)
      .maybeSingle();

    if (data.kind === "in") {
      if (existing?.in_at) throw new Error("You have already punched in today");
      const row = { employee_id: emp.id, work_date: day, in_at: now, source: "app", in_lat: data.lat, in_lng: data.lng, location_id: locationId, selfie_path: selfiePath, face_score: score };
      const { error } = existing
        ? await admin.from("attendance_days").update(row).eq("id", existing.id)
        : await admin.from("attendance_days").insert(row);
      if (error) throw new Error(error.message);
    } else {
      if (!existing?.in_at) throw new Error("Punch in first, or raise a regularization");
      const { error } = await admin.from("attendance_days").update({ out_at: now, face_score: score }).eq("id", existing.id);
      if (error) throw new Error(error.message);
    }
    return { at: now, location: locationName };
  });
