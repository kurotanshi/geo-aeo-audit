import { describe, it, expect } from "vitest";
import { isPublicUnicastIp } from "../src/transport/ip-guard.js";

describe("isPublicUnicastIp", () => {
  it("accepts public IPv4 addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "203.0.114.1"]) {
      expect(isPublicUnicastIp(ip), ip).toBe(true);
    }
  });

  it("rejects non-public IPv4 ranges", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1", // CGN
      "127.0.0.1", // loopback
      "169.254.169.254", // cloud metadata
      "172.16.5.4",
      "192.168.1.1",
      "192.0.2.5", // TEST-NET-1
      "198.18.0.1", // benchmarking
      "198.51.100.7", // TEST-NET-2
      "203.0.113.9", // TEST-NET-3
      "224.0.0.1", // multicast
      "240.0.0.1", // reserved
      "255.255.255.255", // broadcast
    ]) {
      expect(isPublicUnicastIp(ip), ip).toBe(false);
    }
  });

  it("accepts public global-unicast IPv6 addresses", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
      expect(isPublicUnicastIp(ip), ip).toBe(true);
    }
  });

  it("rejects non-public / embedded IPv6 addresses", () => {
    for (const ip of [
      "::1", // loopback
      "::", // unspecified
      "fe80::1", // link-local
      "fc00::1", // ULA
      "fd12:3456::1", // ULA
      "ff02::1", // multicast
      "2001:db8::1", // documentation
      "2002::1", // 6to4 (embeds IPv4)
      "::ffff:8.8.8.8", // IPv4-mapped, even to a public v4
      "::ffff:10.0.0.1", // IPv4-mapped private
      "64:ff9b::8.8.8.8", // NAT64
    ]) {
      expect(isPublicUnicastIp(ip), ip).toBe(false);
    }
  });

  it("rejects non-IP strings", () => {
    for (const s of ["example.com", "", "not-an-ip", "999.999.999.999"]) {
      expect(isPublicUnicastIp(s), s).toBe(false);
    }
  });
});
