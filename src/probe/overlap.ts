import { normalizeHttpUrl } from "../discovery/url.js";
import type { OverlapAttempt, SourceOverlapPair } from "../schema/probe.js";
import { registrableDomain } from "./target.js";

export function calculateSourceOverlaps(attempts: readonly OverlapAttempt[]): SourceOverlapPair[] {
  const completed = attempts.filter((attempt) => attempt.completed);
  const pairs: SourceOverlapPair[] = [];
  // ponytail: O(n²) is bounded by the 100-attempt cap; bucket/index if that cap grows.
  for (let leftIndex = 0; leftIndex < completed.length; leftIndex += 1) {
    const left = completed[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < completed.length; rightIndex += 1) {
      const right = completed[rightIndex]!;
      if (groupKey(left) !== groupKey(right)) continue;
      const leftUrls = citedUrls(left);
      const rightUrls = citedUrls(right);
      pairs.push({
        provider: left.provider,
        requested_model: left.requested_model,
        returned_model: left.returned_model,
        api_surface: left.api_surface,
        search_settings: { ...left.search_settings },
        left_ordinal: left.ordinal,
        right_ordinal: right.ordinal,
        url_source_overlap: jaccard(leftUrls, rightUrls),
        domain_source_overlap: jaccard(domains(leftUrls), domains(rightUrls)),
      });
    }
  }
  return pairs;
}

function groupKey(attempt: OverlapAttempt): string {
  return JSON.stringify([
    attempt.provider,
    attempt.requested_model,
    attempt.returned_model,
    attempt.api_surface,
    attempt.search_settings.locale ?? null,
    attempt.search_settings.country ?? null,
    attempt.search_settings.timezone ?? null,
  ]);
}

function citedUrls(attempt: OverlapAttempt): Set<string> {
  const urls = new Set<string>();
  for (const citation of attempt.citations) {
    if (citation.url.status !== "present" || citation.url.value === null) continue;
    try {
      urls.add(normalizeHttpUrl(citation.url.value));
    } catch {
      // A provider-exposed invalid URL cannot enter URL or domain overlap.
    }
  }
  return urls;
}

function domains(urls: Set<string>): Set<string> {
  const values = new Set<string>();
  for (const url of urls) {
    const domain = registrableDomain(new URL(url).hostname);
    if (domain !== null) values.add(domain);
  }
  return values;
}

function jaccard(left: Set<string>, right: Set<string>): number | null {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return null;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}
