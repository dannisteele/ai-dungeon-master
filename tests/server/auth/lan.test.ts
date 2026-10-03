import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "../../../src/server/auth/lan";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.20", "169.254.3.4",
    "::1", "::ffff:192.168.1.5", "fd12:3456::1", "fe80::1", "fe80::1%en0",
  ])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "2001:4860::8888", "::ffff:8.8.8.8", "", "not-an-ip"])(
    "blocks %s", (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});
