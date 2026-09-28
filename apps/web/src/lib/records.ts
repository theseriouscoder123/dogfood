import type { RecordStatement } from "./types";

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** One sentence saying what the record attests. */
export function attestation(s: RecordStatement): string {
  if (s.type === "judge_participation") {
    const n = s.claims.reviewsSubmitted ?? 0;
    return `served as a judge at ${s.event.name}, submitting ${n} review${n === 1 ? "" : "s"} across ${s.claims.projectsReviewed ?? 0} project${s.claims.projectsReviewed === 1 ? "" : "s"}.`;
  }
  return `took part in ${s.event.name} with team ${s.claims.team}, building “${s.claims.project?.title}”.`;
}

export const recordTitle = (s: Pick<RecordStatement, "type">) => (s.type === "judge_participation" ? "Judge participation record" : "Certificate of participation");

/** Browser-side check: Ed25519 over the exact signed text, with the published key. null = this browser can't do Ed25519. */
export async function verifyInBrowser(publicKeyPem: string, signedText: string, signature: string): Promise<boolean | null> {
  try {
    const der = Uint8Array.from(atob(publicKeyPem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, false, ["verify"]);
    const b64 = signature.replace(/-/g, "+").replace(/_/g, "/");
    const sig = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, new TextEncoder().encode(signedText));
  } catch (err) {
    if (err instanceof DOMException && (err.name === "NotSupportedError" || err.name === "DataError")) return null;
    return false;
  }
}
