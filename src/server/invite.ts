import type { NetworkInterfaceInfo } from "node:os";
import { isPrivateAddress } from "./auth/lan";

/** An address other players on the same Wi-Fi can type in to reach this table. */
export interface InviteAddress { url: string; adapter: string }

/** Adapters that are usually virtual (VMs, WSL, Docker, VPNs): a phone on the Wi-Fi can't reach them. */
const VIRTUAL_ADAPTER = /vethernet|wsl|hyper-v|virtualbox|vmware|vbox|docker|br-|virbr|tailscale|zerotier|wireguard|vpn|tun|tap|utun|loopback/i;
/** Adapters that are usually the real Wi-Fi or cable connection. */
const HOME_ADAPTER = /wi-?fi|wlan|wireless|ethernet|^en\d|^eth\d|^wlp|^enp/i;

function rank(adapter: string, ip: string): number {
  let score = 0;
  if (VIRTUAL_ADAPTER.test(adapter)) score += 100;
  else if (!HOME_ADAPTER.test(adapter)) score += 10;
  // Home routers almost always hand out 192.168.x.x; 10.x and 172.16–31.x are often VPNs or VMs.
  if (!ip.startsWith("192.168.")) score += 1;
  return score;
}

/**
 * The addresses to send other players, most likely first. Only private IPv4 addresses count:
 * the server refuses anything else anyway (src/server/auth/plugin.ts), and loopback and
 * link-local (169.254.x.x) addresses never work from another device.
 */
export function inviteAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, port: number): InviteAddress[] {
  const found: (InviteAddress & { score: number })[] = [];
  for (const [adapter, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      const ip = info.address;
      if (info.family !== "IPv4" || info.internal || !isPrivateAddress(ip)) continue;
      if (ip.startsWith("127.") || ip.startsWith("169.254.")) continue;
      found.push({ url: `http://${ip}:${port}`, adapter, score: rank(adapter, ip) });
    }
  }
  return found
    .sort((a, b) => a.score - b.score)
    .filter((a, i, all) => all.findIndex((b) => b.url === a.url) === i)
    .map(({ url, adapter }) => ({ url, adapter }));
}
