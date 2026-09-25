import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/oauth/outlook/return")({
  head: () => ({ meta: [{ title: "Finishing Outlook sign-in — AIONOS HR" }, { name: "robots", content: "noindex" }] }),
  component: OutlookReturn,
});

function OutlookReturn() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    window.opener?.postMessage(
      code
        ? { type: "appUserConnectorOAuthComplete", connectorId: "microsoft_outlook", code }
        : { type: "appUserConnectorOAuthFailed", connectorId: "microsoft_outlook", error: params.get("error") ?? "missing_code" },
      window.location.origin,
    );
    window.close();
  }, []);

  return <main className="min-h-screen grid place-items-center bg-paper text-ink"><p className="text-sm">You can close this window.</p></main>;
}
