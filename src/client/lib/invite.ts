import type { InviteAddress } from "./api";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The links to offer, best first. If this device already reached the table by a network address
 * (e.g. a phone on http://192.168.1.176:3000), that address is known to work, so it leads.
 * "localhost" never works from another device, so it's never offered.
 */
export function inviteLinks(addresses: InviteAddress[], here: { hostname: string; origin: string }): string[] {
  const links = addresses.map((a) => a.url);
  if (!LOCAL_HOSTS.has(here.hostname)) links.unshift(here.origin);
  return [...new Set(links)];
}
