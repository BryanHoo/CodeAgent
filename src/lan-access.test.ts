import type { NetworkInterfaceInfo } from "node:os";

import { describe, expect, it } from "vitest";

import { generateLanPairingCode, listLanAccessUrls, parseSessionTtl } from "./lan-access.js";

describe("LAN access helpers", () => {
  it("parses bounded minute, hour, and day durations", () => {
    expect(parseSessionTtl("1m")).toBe(60_000);
    expect(parseSessionTtl("12h")).toBe(43_200_000);
    expect(parseSessionTtl("30d")).toBe(2_592_000_000);
    for (const invalid of ["0m", "59s", "1.5h", "31d", "999999999999999999999d", " 1h"]) {
      expect(() => parseSessionTtl(invalid)).toThrow(/session TTL/u);
    }
  });

  it("generates URL-safe codes with at least 128 bits of randomness", () => {
    const first = generateLanPairingCode();
    const second = generateLanPairingCode();
    expect(first).toMatch(/^[A-Za-z0-9_-]{22,}$/u);
    expect(second).not.toBe(first);
  });

  it("lists only valid external IPv4 LAN URLs in stable order", () => {
    const ipv4 = (address: string, internal = false): NetworkInterfaceInfo => ({
      address,
      cidr: `${address}/24`,
      family: "IPv4",
      internal,
      mac: "00:00:00:00:00:00",
      netmask: "255.255.255.0",
      scopeid: 0,
    });
    const urls = listLanAccessUrls(3210, {
      en0: [ipv4("192.168.1.20"), ipv4("127.0.0.1", true)],
      en1: [
        ipv4("10.0.0.8"),
        {
          address: "fe80::1",
          cidr: "fe80::1/64",
          family: "IPv6",
          internal: false,
          mac: "00:00:00:00:00:00",
          netmask: "ffff:ffff:ffff:ffff::",
          scopeid: 1,
        },
      ],
      invalid: [ipv4("not-an-ip")],
    });

    expect(urls).toEqual(["http://10.0.0.8:3210", "http://192.168.1.20:3210"]);
  });
});
