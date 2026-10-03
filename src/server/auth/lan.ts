import { isIPv4, isIPv6 } from "node:net";

export function isPrivateAddress(ip: string): boolean {
  let addr = ip.trim().toLowerCase().split("%")[0];
  if (addr.startsWith("::ffff:") && isIPv4(addr.slice(7))) addr = addr.slice(7);
  if (isIPv4(addr)) {
    const [a, b] = addr.split(".").map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIPv6(addr)) {
    if (addr === "::1") return true;
    const first = parseInt(addr.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return false;
}
