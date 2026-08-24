export interface RobotsRule {
  directive: "allow" | "disallow";
  pattern: string;
}

export interface RobotsDecision {
  allowed: boolean;
  matchedRule?: RobotsRule;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

/** Parse the parts of RFC 9309 used by the audit crawler. Unknown fields are ignored. */
export function parseRobotsTxt(input: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | undefined;

  for (const rawLine of input.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "sitemap") {
      if (value !== "") sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (value === "") continue;
      if (current === undefined || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if ((field === "allow" || field === "disallow") && current !== undefined) {
      // An empty Disallow means "allow everything", so it adds no rule.
      if (value !== "") current.rules.push({ directive: field, pattern: value });
    }
  }

  return { groups, sitemaps };
}

/** Apply longest-match precedence; Allow wins ties as required by RFC 9309. */
export function evaluateRobots(parsed: ParsedRobots, url: string | URL, productToken: string): RobotsDecision {
  const target = typeof url === "string" ? new URL(url) : url;
  const token = productToken.toLowerCase();
  let bestAgentLength = -1;
  const selected: RobotsGroup[] = [];

  for (const group of parsed.groups) {
    const matching = group.agents.filter((agent) => agent === "*" || token === agent || token.startsWith(agent));
    if (matching.length === 0) continue;
    const length = Math.max(...matching.map((agent) => (agent === "*" ? 0 : agent.length)));
    if (length > bestAgentLength) {
      bestAgentLength = length;
      selected.length = 0;
      selected.push(group);
    } else if (length === bestAgentLength) {
      selected.push(group);
    }
  }

  let winner: { rule: RobotsRule; specificity: number } | undefined;
  const path = `${target.pathname}${target.search}`;
  for (const group of selected) {
    for (const rule of group.rules) {
      if (!matchesPattern(path, rule.pattern)) continue;
      const specificity = rule.pattern.replace(/\*|\$$/g, "").length;
      if (
        winner === undefined ||
        specificity > winner.specificity ||
        (specificity === winner.specificity && rule.directive === "allow" && winner.rule.directive === "disallow")
      ) {
        winner = { rule, specificity };
      }
    }
  }

  return winner === undefined
    ? { allowed: true }
    : { allowed: winner.rule.directive === "allow", matchedRule: winner.rule };
}

function matchesPattern(path: string, pattern: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const expression = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}${anchored ? "$" : ""}`).test(path);
}
