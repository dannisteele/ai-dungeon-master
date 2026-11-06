import { describe, expect, it } from "vitest";
import { inviteLinks } from "../../src/client/lib/invite";

const addresses = [
  { url: "http://192.168.1.176:3000", adapter: "WiFi" },
  { url: "http://10.8.0.5:3000", adapter: "VPN" },
];

describe("inviteLinks", () => {
  it("never offers localhost, since it only works on the host computer", () => {
    expect(inviteLinks(addresses, { hostname: "localhost", origin: "http://localhost:3000" }))
      .toEqual(["http://192.168.1.176:3000", "http://10.8.0.5:3000"]);
    expect(inviteLinks(addresses, { hostname: "127.0.0.1", origin: "http://127.0.0.1:3000" })[0]).toBe("http://192.168.1.176:3000");
  });

  it("leads with the address this device used, since that one is known to work", () => {
    expect(inviteLinks(addresses, { hostname: "10.8.0.5", origin: "http://10.8.0.5:3000" }))
      .toEqual(["http://10.8.0.5:3000", "http://192.168.1.176:3000"]);
  });

  it("is empty when the host isn't on a network and this is the host", () => {
    expect(inviteLinks([], { hostname: "localhost", origin: "http://localhost:3000" })).toEqual([]);
  });
});
