import { BlockList, isIP } from "node:net";

// Rejected IPv4 ranges (everything not global-unicast). Anything not blocked is public.
const V4_DENY = new BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], // "this network" / unspecified
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGN / shared address space
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. 169.254.169.254 metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1 (documentation)
  ["192.88.99.0", 24], // 6to4 relay anycast (deprecated)
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2 (documentation)
  ["203.0.113.0", 24], // TEST-NET-3 (documentation)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved (incl. 255.255.255.255 broadcast)
] as const) {
  V4_DENY.addSubnet(addr, prefix, "ipv4");
}

// IPv6 is allow-listed: only global unicast (2000::/3), minus embedded/doc ranges.
const V6_ALLOW = new BlockList();
V6_ALLOW.addSubnet("2000::", 3, "ipv6");

const V6_DENY = new BlockList();
for (const [addr, prefix] of [
  ["2001:db8::", 32], // documentation
  ["2001:10::", 28], // ORCHID (deprecated)
  ["2001:20::", 28], // ORCHIDv2
  ["2002::", 16], // 6to4 (embeds IPv4)
  ["3fff::", 20], // documentation (RFC 9637)
] as const) {
  V6_DENY.addSubnet(addr, prefix, "ipv6");
}

/**
 * True only for a public, global-unicast IP literal. Fail-closed: anything that
 * is not a plain IPv4/IPv6 literal, or is loopback/private/link-local/ULA/
 * multicast/reserved/documentation, or an IPv4-mapped/embedded IPv6 address,
 * returns false. Input must already be an IP string (hostnames resolve first).
 */
export function isPublicUnicastIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return !V4_DENY.check(ip, "ipv4");
  }
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) and other embeds fall outside 2000::/3 → rejected here.
    return V6_ALLOW.check(ip, "ipv6") && !V6_DENY.check(ip, "ipv6");
  }
  return false;
}
