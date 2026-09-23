import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/oauth/teams/return")({
  head: () => ({
    meta: [
      { title: "Finishing Microsoft sign-in — AIONOS HR" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TeamsReturn,
});

function TeamsReturn() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const payload = code
      ? { type: "appUserConnectorOAuthComplete", connectorId: "microsoft_teams", code }
      : {
          type: "appUserConnectorOAuthFailed",
          connectorId: "microsoft_teams",
          error: params.get("error") ?? "missing_code",
        };
    window.opener?.postMessage(payload, window.location.origin);
    window.close();
  }, []);

  return (
    <main className="min-h-screen grid place-items-center bg-paper text-ink">
      <p className="text-sm">You can close this window.</p>
    </main>
  );
}
