import { RULESET_VERSION } from "../version.js";

export type AgentKind =
  | "search_crawler"
  | "training_crawler"
  | "user_triggered_fetcher"
  | "product_control_token";

export type RobotsApplicability = "applies" | "may_apply" | "generally_ignored" | "control_token";

export interface AgentRegistryEntry {
  id: string;
  provider:
    | "google"
    | "microsoft"
    | "openai"
    | "anthropic"
    | "perplexity"
    | "apple"
    | "meta"
    | "amazon"
    | "commoncrawl"
    | "mistral"
    | "duckduckgo";
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

const CHECKED_AT = "2026-09-03";

/**
 * Versioned registry of the provider agents in the current ruleset.
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
    productScopes: [
      "google_search",
      "google_discover",
      "google_images",
      "google_video",
      "google_news",
      "google_ai_overviews",
      "google_ai_mode",
    ],
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
    id: "google.google_agent",
    provider: "google",
    productToken: "Google-Agent",
    agentKind: "user_triggered_fetcher",
    robotsApplicability: "generally_ignored",
    productScopes: ["google_user_requested_fetch"],
    officialSourceUrl: "https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Google documents Google-Agent as a user-triggered fetcher used by agents hosted on Google infrastructure; such fetchers generally ignore robots.txt.",
  },
  {
    id: "google.google_gemini_notebook",
    provider: "google",
    productToken: "Google-GeminiNotebook",
    agentKind: "user_triggered_fetcher",
    robotsApplicability: "generally_ignored",
    productScopes: ["google_gemini_notebook"],
    officialSourceUrl: "https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Google documents Google-GeminiNotebook as a user-triggered fetcher for URLs supplied to Gemini Notebook projects; such fetchers generally ignore robots.txt.",
  },
  {
    id: "microsoft.bingbot",
    provider: "microsoft",
    productToken: "bingbot",
    agentKind: "search_crawler",
    robotsApplicability: "applies",
    productScopes: ["bing_search", "bing_copilot"],
    officialSourceUrl: "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0",
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
    officialSourceUrl: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
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
    officialSourceUrl: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
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
    officialSourceUrl: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
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
  {
    id: "apple.applebot",
    provider: "apple",
    productToken: "Applebot",
    agentKind: "search_crawler",
    robotsApplicability: "applies",
    productScopes: ["apple_search", "apple_ai_answers"],
    officialSourceUrl: "https://support.apple.com/en-us/119829",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Apple documents Applebot as its web crawler for Apple search experiences and states that it respects standard robots.txt directives.",
  },
  {
    id: "apple.applebot_extended",
    provider: "apple",
    productToken: "Applebot-Extended",
    agentKind: "product_control_token",
    robotsApplicability: "control_token",
    productScopes: ["apple_model_training"],
    officialSourceUrl: "https://support.apple.com/en-us/119829",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Applebot-Extended is a robots.txt control token for opting out of Apple foundation-model training; it does not crawl webpages.",
  },
  {
    id: "meta.meta_external_agent",
    provider: "meta",
    productToken: "Meta-ExternalAgent",
    agentKind: "training_crawler",
    robotsApplicability: "applies",
    productScopes: ["meta_model_training", "meta_ai_search"],
    officialSourceUrl: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Meta documents Meta-ExternalAgent for AI training and indexing activity and provides it as a robots.txt controllable crawler.",
  },
  {
    id: "meta.meta_external_fetcher",
    provider: "meta",
    productToken: "Meta-ExternalFetcher",
    agentKind: "user_triggered_fetcher",
    robotsApplicability: "may_apply",
    productScopes: ["meta_user_requested_fetch"],
    officialSourceUrl: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Meta documents Meta-ExternalFetcher for user-triggered fetches, so robots.txt applicability is not asserted as a definitive eligibility requirement.",
  },
  {
    id: "meta.meta_webindexer",
    provider: "meta",
    productToken: "meta-webindexer",
    agentKind: "search_crawler",
    robotsApplicability: "applies",
    productScopes: ["meta_ai_search"],
    officialSourceUrl: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Meta documents meta-webindexer as an indexing crawler for Meta AI search and provides it as a robots.txt controllable crawler.",
  },
  {
    id: "amazon.amazonbot",
    provider: "amazon",
    productToken: "Amazonbot",
    agentKind: "training_crawler",
    robotsApplicability: "applies",
    productScopes: ["amazon_products", "amazon_model_training"],
    officialSourceUrl: "https://developer.amazon.com/amazonbot",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Amazon documents Amazonbot as a crawler used to improve Amazon products and services and potentially train Amazon AI models.",
  },
  {
    id: "amazon.amzn_searchbot",
    provider: "amazon",
    productToken: "Amzn-SearchBot",
    agentKind: "search_crawler",
    robotsApplicability: "applies",
    productScopes: ["amazon_search"],
    officialSourceUrl: "https://developer.amazon.com/amazonbot",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Amazon documents Amzn-SearchBot for search experiences in Amazon products and services and states that it respects robots.txt.",
  },
  {
    id: "amazon.amzn_user",
    provider: "amazon",
    productToken: "Amzn-User",
    agentKind: "user_triggered_fetcher",
    robotsApplicability: "may_apply",
    productScopes: ["amazon_user_requested_fetch"],
    officialSourceUrl: "https://developer.amazon.com/amazonbot",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Amazon documents Amzn-User for live information fetched on a customer's behalf and notes that it may not follow all robots.txt directives.",
  },
  {
    id: "commoncrawl.ccbot",
    provider: "commoncrawl",
    productToken: "CCBot",
    agentKind: "training_crawler",
    robotsApplicability: "applies",
    productScopes: ["commoncrawl_dataset"],
    officialSourceUrl: "https://commoncrawl.org/ccbot",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Common Crawl documents CCBot and provides a robots.txt rule to prevent it from crawling a website.",
  },
  {
    id: "mistral.mistral_ai_training",
    provider: "mistral",
    productToken: "MistralAI-Training",
    agentKind: "training_crawler",
    robotsApplicability: "applies",
    productScopes: ["mistral_model_training"],
    officialSourceUrl: "https://docs.mistral.ai/robots",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Mistral documents MistralAI-Training as a crawler for training datasets and states that webmasters can disallow it in robots.txt.",
  },
  {
    id: "mistral.mistral_ai_index",
    provider: "mistral",
    productToken: "MistralAI-Index",
    agentKind: "search_crawler",
    robotsApplicability: "applies",
    productScopes: ["mistral_search"],
    officialSourceUrl: "https://docs.mistral.ai/robots",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Mistral documents MistralAI-Index as an automated indexing crawler for Mistral search.",
  },
  {
    id: "mistral.mistral_ai_user",
    provider: "mistral",
    productToken: "MistralAI-User",
    agentKind: "user_triggered_fetcher",
    robotsApplicability: "applies",
    productScopes: ["mistral_user_requested_fetch"],
    officialSourceUrl: "https://docs.mistral.ai/robots",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "Mistral documents MistralAI-User for user actions in Vibe and states that it governs which sites those requests can access.",
  },
  {
    id: "duckduckgo.duckassistbot",
    provider: "duckduckgo",
    productToken: "DuckAssistBot",
    agentKind: "search_crawler",
    robotsApplicability: "applies",
    productScopes: ["duckduckgo_ai_answers"],
    officialSourceUrl: "https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot",
    checkedAt: CHECKED_AT,
    rulesetVersion: RULESET_VERSION,
    officialSummary: "DuckDuckGo documents DuckAssistBot as a real-time crawler for AI-assisted search answers and supports opting out through robots.txt.",
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
