import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { inviteAddresses } from "../../src/server/invite";

const v4 = (address: string, internal = false) => ({ address, family: "IPv4", internal }) as NetworkInterfaceInfo;
const v6 = (address: string) => ({ address, family: "IPv6", internal: false }) as NetworkInterfaceInfo;

describe("inviteAddresses", () => {
  it("offers the Wi-Fi address with the port", () => {
    expect(inviteAddresses({ WiFi: [v4("192.168.1.176")] }, 3000)).toEqual([{ url: "http://192.168.1.176:3000", adapter: "WiFi" }]);
  });

  it("leaves out loopback, link-local, public and IPv6 addresses", () => {
    expect(inviteAddresses({
      "Loopback Pseudo-Interface 1": [v4("127.0.0.1", true)],
      "Ethernet 2": [v4("169.254.10.3")],
      Public: [v4("81.2.69.160")],
      WiFi: [v6("fe80::1"), v4("192.168.1.176")],
    }, 3000).map((a) => a.url)).toEqual(["http://192.168.1.176:3000"]);
  });

  it("puts the Wi-Fi ahead of virtual and VPN adapters, whatever order Windows lists them in", () => {
    const urls = inviteAddresses({
      "vEthernet (WSL)": [v4("172.20.0.1")],
      "Tailscale": [v4("100.64.0.1")],
      "Cisco VPN": [v4("10.8.0.5")],
      WiFi: [v4("192.168.1.176")],
    }, 3000).map((a) => a.url);
    expect(urls[0]).toBe("http://192.168.1.176:3000");
    expect(urls).toContain("http://10.8.0.5:3000");
    expect(urls).not.toContain("http://100.64.0.1:3000"); // carrier-grade NAT isn't a private LAN address
  });

  it("prefers a 192.168 address over a 10.x one on the same kind of adapter", () => {
    const urls = inviteAddresses({ Ethernet: [v4("10.0.0.4")], "Wi-Fi": [v4("192.168.0.20")] }, 8080).map((a) => a.url);
    expect(urls).toEqual(["http://192.168.0.20:8080", "http://10.0.0.4:8080"]);
  });

  it("returns nothing when the computer isn't on a network", () => {
    expect(inviteAddresses({ lo: [v4("127.0.0.1", true)] }, 3000)).toEqual([]);
  });
});
