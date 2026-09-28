// Server-side request forgery guard. An organizer chooses where the server sends webhooks, so
// without this a webhook could be aimed at the database, the cloud metadata service or anything
// else on the private network. Hosts in WEBHOOK_ALLOW_PRIVATE_HOSTS (e.g. an internal receiver)
// are exempt.
import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blocked.addSubnet(net, prefix, "ipv6");

export function isPrivateAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mapped) return isPrivateAddress(mapped);
  const family = isIP(address);
  if (family === 0) return true; // not an address at all: refuse rather than guess
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export type UrlProblem = string | null;

/** Checks that need no network: scheme, credentials, and literal private addresses. Used when an organizer saves a URL. */
export function checkWebhookUrl(raw: string, allowHosts: readonly string[]): UrlProblem {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That isn't a valid URL.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Use an http:// or https:// URL.";
  if (url.username || url.password) return "Put credentials in your receiver's config, not in the URL: every request is already signed.";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (allowHosts.includes(host)) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return "Webhooks can't be sent to this server's own network.";
  if (isIP(host) && isPrivateAddress(host)) return "Webhooks can't be sent to private or internal addresses.";
  return null;
}

/** The same checks at send time, after resolving the name, so a public name that points inward is caught too. */
export async function resolveForDelivery(raw: string, allowHosts: readonly string[]): Promise<UrlProblem> {
  const problem = checkWebhookUrl(raw, allowHosts);
  if (problem) return problem;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (allowHosts.includes(host) || isIP(host)) return null;
  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.some((a) => isPrivateAddress(a.address))) return `${host} resolves to a private address.`;
  } catch {
    return `Couldn't resolve ${host}.`;
  }
  return null;
}
