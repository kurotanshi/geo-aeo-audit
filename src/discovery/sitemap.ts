export type SitemapDocument =
  | { kind: "urlset"; locations: string[] }
  | { kind: "index"; locations: string[] };

/**
 * Extract sitemap locations without resolving DTDs or external entities.
 * A sitemap only needs its root kind and loc text for discovery.
 */
export function parseSitemapXml(input: string): SitemapDocument {
  const root = input.match(/<(?:[A-Za-z_][\w.-]*:)?(urlset|sitemapindex)(?:\s|>)/i)?.[1]?.toLowerCase();
  if (root !== "urlset" && root !== "sitemapindex") {
    throw new TypeError("document is not a sitemap urlset or sitemapindex");
  }

  const locations: string[] = [];
  const locPattern = /<(?:[A-Za-z_][\w.-]*:)?loc(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?loc\s*>/gi;
  for (const match of input.matchAll(locPattern)) {
    const value = decodeXmlText(match[1] ?? "").trim();
    if (value !== "") locations.push(value);
  }
  return { kind: root === "urlset" ? "urlset" : "index", locations };
}

function decodeXmlText(value: string): string {
  const text = value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1");
  return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
    const lower = entity.toLowerCase();
    if (named[lower] !== undefined) return named[lower];
    const hex = lower.startsWith("&#x");
    const digits = entity.slice(hex ? 3 : 2, -1);
    const codePoint = Number.parseInt(digits, hex ? 16 : 10);
    return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
  });
}
