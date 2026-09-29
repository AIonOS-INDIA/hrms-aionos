 // Server-only: verifies the token Outlook attaches when a manager clicks a card button.
// Outlook signs it with Microsoft's key (RS256). We check the signature with Microsoft's
// public keys, then check who issued it, who it is for, and that it hasn't expired.
// Uses only the built-in Web Crypto API, so no extra package is needed.

const MS_ISSUER = "https://substrate.office.com/sts/";
const MS_KEYS_URL = "https://substrate.office.com/sts/common/discovery/keys";

type Jwk = JsonWebKey & { kid?: string };
type KeyFetcher = (forceRefresh: boolean) => Promise<Jwk[]>;

let cachedKeys: { keys: Jwk[]; fetchedAt: number } | null = null;

/** Microsoft's public signing keys, cached for an hour. */
async function microsoftKeys(forceRefresh: boolean): Promise<Jwk[]> {
  if (!forceRefresh && cachedKeys && Date.now() - cachedKeys.fetchedAt < 3_600_000) {
    return cachedKeys.keys;
  }
  const response = await fetch(MS_KEYS_URL);
  if (!response.ok) throw new Error(`Could not load Microsoft keys (${response.status})`);
  const body = (await response.json()) as { keys?: Jwk[] };
  cachedKeys = { keys: body.keys ?? [], fetchedAt: Date.now() };
  return cachedKeys.keys;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonPart(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as Record<string, unknown>;
}

/**
 * Returns the token's claims if it is a valid Outlook action token for one of `audiences`.
 * Throws with a short reason otherwise.
 */
export async function verifyOutlookToken(
  token: string,
  audiences: string[],
  getKeys: KeyFetcher = microsoftKeys,
): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = decodeJsonPart(headerPart);
  if (header["alg"] !== "RS256") throw new Error("unexpected signing algorithm");
  const kid = String(header["kid"] ?? "");

  let jwk = (await getKeys(false)).find((k) => k.kid === kid);
  if (!jwk) jwk = (await getKeys(true)).find((k) => k.kid === kid); // keys may have rotated
  if (!jwk || !jwk.n || !jwk.e) throw new Error("signing key not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedData = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(signaturePart),
    signedData,
  );
  if (!valid) throw new Error("invalid signature");

  const payload = decodeJsonPart(payloadPart);
  if (payload["iss"] !== MS_ISSUER) throw new Error("unexpected issuer");

  const aud = payload["aud"];
  const tokenAudiences = Array.isArray(aud) ? aud.map(String) : [String(aud ?? "")];
  if (!tokenAudiences.some((a) => audiences.includes(a))) throw new Error("unexpected audience");

  const now = Math.floor(Date.now() / 1000);
  const exp = payload["exp"];
  if (typeof exp !== "number" || exp < now - 60) throw new Error("token expired");
  const nbf = payload["nbf"];
  if (typeof nbf === "number" && nbf > now + 60) throw new Error("token not yet valid");

  return payload;
}