import { RULESET_VERSION } from "../version.js";

export type AgentKind =
  | "search_crawler"
  | "training_crawler"
  | "user_triggered_fetcher"
  | "product_control_token";

export type RobotsApplicability = "applies" | "may_apply" | "generally_ignored" | "control_token";

export interface AgentRegistryEntry {
  id: string;
  provider: "google" | "microsoft" | "openai" | "anthropic" | "perplexity";
  productToken: string;
  agentKind: AgentKind;
  /** Explicit per-agent documentation finding. Never derive this from agentKind. */
  robotsApplicability: RobotsApplicability;
  productScopes: readonly string[];
  officialSourceUrl: string;
  checkedAt: string;
  rulesetVersion: string;
  officialSummary: string;
}

const CHECKED_AT = "2026-08-24";

/**
 * Versioned registry of the provider agents in ruleset 0.1.0.
 *
 * Every applicability value is an observed statement from the linked provider
 * documentation. Agent kind is descriptive and deliberately has no role in
 * deriving whether robots.txt applies.
 */
export const AGENT_REGISTRY = [
  {
    id: "google.googlebot",
    provider: "google",
    productToken: "Googlebot",
    agentKind: "search_crawler",
    robotsApplicability: "applies",
    productScopes: ["google_search", "google_discover", "google_images", "google_video", "google_news"],
    officialSourceUrl: "https://developers.google.com/search/docs/crawling-indexing/googlebot",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Google documents Googlebot as the crawler for Google Search and directs publishers to robots.txt to prevent crawling.",
  },
  {
    id: "google.google_extended",
    provider: "google",
    productToken: "Google-Extended",
    agentKind: "product_control_token",
    robotsApplicability: "control_token",
    productScopes: ["gemini_model_training", "gemini_apps_grounding", "vertex_ai_gemini_grounding"],
    officialSourceUrl: "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Google-Extended has no separate HTTP user agent; it is a robots.txt control token for documented Gemini training and grounding uses.",
  },
  {
    id: "microsoft.bingbot",
    provider: "microsoft",
    productToken: "bingbot",
    agentKind: "search_crawler",
    robotsApplicability: "applies",
    productScopes: ["bing_search"],
    officialSourceUrl: "https://blogs.bing.com/webmaster/May-2012/To-crawl-or-not-to-crawl%2C-that-is-BingBot-s-questi",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Bing documents Bingbot-specific and wildcard robots.txt groups as controls for its search crawler.",
  },
  {
    id: "openai.oai_searchbot",
    provider: "openai",
    productToken: "OAI-SearchBot",
    agentKind: "search_crawler",
    robotsApplicability: "applies",
    productScopes: ["chatgpt_search"],
    officialSourceUrl: "https://developers.openai.com/api/docs/bots",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "OpenAI documents OAI-SearchBot as the robots.txt control for surfacing sites in ChatGPT search results.",
  },
  {
    id: "openai.gptbot",
    provider: "openai",
    productToken: "GPTBot",
    agentKind: "training_crawler",
    robotsApplicability: "applies",
    productScopes: ["openai_model_training"],
    officialSourceUrl: "https://developers.openai.com/api/docs/bots",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "OpenAI documents GPTBot as the control for content that may be used to train generative AI foundation models.",
  },
  {
    id: "openai.chatgpt_user",
    provider: "openai",
    productToken: "ChatGPT-User",
    agentKind: "user_triggered_fetcher",
    robotsApplicability: "may_apply",
    productScopes: ["chatgpt_user_requested_fetch", "custom_gpt_user_requested_fetch"],
    officialSourceUrl: "https://developers.openai.com/api/docs/bots",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "OpenAI states that ChatGPT-User requests are user initiated and robots.txt rules may not apply.",
  },
  {
    id: "anthropic.claude_searchbot",
    provider: "anthropic",
    productToken: "Claude-SearchBot",
    agentKind: "search_crawler",
    robotsApplicability: "applies",
    productScopes: ["claude_search"],
    officialSourceUrl: "https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Anthropic documents Claude-SearchBot for search quality and states that its bots honor standard robots.txt directives.",
  },
  {
    id: "anthropic.claude_user",
    provider: "anthropic",
    productToken: "Claude-User",
    agentKind: "user_triggered_fetcher",
    robotsApplicability: "applies",
    productScopes: ["claude_user_requested_fetch"],
    officialSourceUrl: "https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Anthropic explicitly includes Claude-User in its bots that honor standard robots.txt directives.",
  },
  {
    id: "anthropic.claudebot",
    provider: "anthropic",
    productToken: "ClaudeBot",
    agentKind: "training_crawler",
    robotsApplicability: "applies",
    productScopes: ["anthropic_model_training"],
    officialSourceUrl: "https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Anthropic documents ClaudeBot for model-development collection and states that its bots honor standard robots.txt directives.",
  },
  {
    id: "perplexity.perplexitybot",
    provider: "perplexity",
    productToken: "PerplexityBot",
    agentKind: "search_crawler",
    robotsApplicability: "applies",
    productScopes: ["perplexity_search"],
    officialSourceUrl: "https://docs.perplexity.ai/docs/resources/perplexity-crawlers",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Perplexity documents PerplexityBot as its search crawler and a robots.txt tag for managing search inclusion.",
  },
  {
    id: "perplexity.perplexity_user",
    provider: "perplexity",
    productToken: "Perplexity-User",
    agentKind: "user_triggered_fetcher",
    robotsApplicability: "generally_ignored",
    productScopes: ["perplexity_user_requested_fetch"],
    officialSourceUrl: "https://docs.perplexity.ai/docs/resources/perplexity-crawlers",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Perplexity states that its user-requested fetcher generally ignores robots.txt rules.",
  },
] as const satisfies readonly AgentRegistryEntry[];

export const ALL_PRODUCT_SCOPES = [...new Set(AGENT_REGISTRY.flatMap((entry) => entry.productScopes))].sort();

/** Fail fast if a hand-edited registry loses the invariants required by reports. */
export function validateAgentRegistry(entries: readonly AgentRegistryEntry[] = AGENT_REGISTRY): void {
  const ids = new Set<string>();
  const tokens = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new TypeError(`duplicate agent id: ${entry.id}`);
    ids.add(entry.id);
    const token = entry.productToken.toLowerCase();
    if (tokens.has(token)) throw new TypeError(`duplicate product token: ${entry.productToken}`);
    tokens.add(token);
    if (entry.productScopes.length === 0) throw new TypeError(`${entry.id} has no product scope`);
    if (entry.rulesetVersion !== RULESET_VERSION) throw new TypeError(`${entry.id} has a stale ruleset version`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.checkedAt)) throw new TypeError(`${entry.id} has an invalid checkedAt date`);
    const source = new URL(entry.officialSourceUrl);
    if (source.protocol !== "https:") throw new TypeError(`${entry.id} official source must use HTTPS`);
  }
}
