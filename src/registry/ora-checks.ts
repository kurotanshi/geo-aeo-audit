export type OraEssentialsTier = "required" | "recommended" | "emerging" | "excluded";
export type OraMapping = "equivalent" | "composite" | "partial" | "not_ported";

export interface OraCheckCrosswalkEntry {
  id: string;
  name: string;
  essentialsTier: OraEssentialsTier;
  mapping: OraMapping;
  localRuleIds: readonly string[];
  explanation: string;
}

export const ORA_CHECKS_CONTRACT_VERSION = "1.21.0";
export const ORA_CHECKS_CHECKED_AT = "2026-08-25";

/** Public web-surface checks from Ora's essentials-expanded 1.21.0 catalog. */
export const ORA_CHECK_CROSSWALK: readonly OraCheckCrosswalkEntry[] = [
  { id: "agentic-search-usecase", name: "Category share of voice", essentialsTier: "emerging", mapping: "not_ported", localRuleIds: [], explanation: "Requires external search-result observation, outside a bounded page audit." },
  { id: "agentic-search-specific", name: "Developer resource discoverability", essentialsTier: "recommended", mapping: "not_ported", localRuleIds: [], explanation: "Requires external search-result observation." },
  { id: "brand-search-accuracy", name: "Brand name discoverability", essentialsTier: "recommended", mapping: "not_ported", localRuleIds: [], explanation: "Requires external search-result observation." },
  { id: "wikipedia-presence", name: "Wikipedia / Wikidata entity presence", essentialsTier: "recommended", mapping: "not_ported", localRuleIds: [], explanation: "Requires third-party entity lookup rather than target-origin evidence." },
  { id: "sitemap", name: "Sitemap exists", essentialsTier: "recommended", mapping: "partial", localRuleIds: ["technical.sitemap_membership"], explanation: "The local rule checks whether the sampled page appears in a parsed sitemap, not sitemap existence alone." },
  { id: "content-no-js", name: "Content without JavaScript", essentialsTier: "required", mapping: "partial", localRuleIds: ["technical.initial_html_content"], explanation: "The local informational rule observes initial-HTML text but never fails and does not apply Ora's 500-character threshold." },
  { id: "bot-detection", name: "Not blocked by bot detection", essentialsTier: "required", mapping: "not_ported", localRuleIds: [], explanation: "Not ported because the local audit does not impersonate ChatGPT-User, ClaudeBot, or other crawler user agents." },
  { id: "robots-ai-policy-quality", name: "robots.txt AI crawler policy", essentialsTier: "excluded", mapping: "composite", localRuleIds: ["technical.robots.openai.oai_searchbot", "technical.robots.openai.gptbot", "technical.robots.anthropic.claudebot"], explanation: "Local provider-scoped robots findings expose policy decisions but do not reproduce Ora's quality rubric; Ora excludes this check from essentials." },
  { id: "agent-discovery-file", name: "Agent discovery file", essentialsTier: "emerging", mapping: "not_ported", localRuleIds: [], explanation: "The local audit does not probe Agent Skills indexes." },
  { id: "agent-rules-repo", name: "Agent platform configs", essentialsTier: "emerging", mapping: "not_ported", localRuleIds: [], explanation: "Requires public repository discovery outside the target page." },
  { id: "pricing-md", name: "pricing.md exists", essentialsTier: "emerging", mapping: "not_ported", localRuleIds: [], explanation: "The local audit does not probe pricing.md." },
  { id: "nlweb-schema-feeds", name: "NLWeb Schema Feeds", essentialsTier: "emerging", mapping: "not_ported", localRuleIds: [], explanation: "The local audit does not implement NLWeb feed discovery." },
  { id: "agent-mode-view", name: "Agent mode view", essentialsTier: "emerging", mapping: "not_ported", localRuleIds: [], explanation: "The local audit does not request a mode=agent representation." },
  { id: "link-headers-discovery", name: "HTTP Link headers (RFC 8288)", essentialsTier: "recommended", mapping: "not_ported", localRuleIds: [], explanation: "The current ruleset does not interpret HTTP Link discovery relations." },
  { id: "markdown-url-fallback", name: "Markdown URL fallback", essentialsTier: "emerging", mapping: "not_ported", localRuleIds: [], explanation: "The local audit does not probe /index.md or per-page .md twins." },
  { id: "sitemap-lastmod", name: "Sitemap freshness (lastmod)", essentialsTier: "recommended", mapping: "not_ported", localRuleIds: [], explanation: "Sitemap discovery does not evaluate lastmod freshness." },
  { id: "robots-agent-user-policy", name: "robots.txt agent-user policy", essentialsTier: "excluded", mapping: "composite", localRuleIds: ["technical.robots.openai.chatgpt_user", "technical.robots.anthropic.claude_user", "technical.robots.perplexity.perplexity_user"], explanation: "Local findings report documented applicability without Ora's policy rubric; Ora excludes this check from essentials." },
  { id: "llms-txt-exists", name: "llms.txt exists", essentialsTier: "emerging", mapping: "partial", localRuleIds: ["technical.llms_txt"], explanation: "Both standard locations are probed, but the local rule additionally requires substantial non-HTML content." },
  { id: "llms-txt-formatting", name: "llms.txt formatting", essentialsTier: "emerging", mapping: "not_ported", localRuleIds: [], explanation: "The local existence probe does not grade llms.txt structure." },
  { id: "json-ld", name: "JSON-LD structured data", essentialsTier: "recommended", mapping: "partial", localRuleIds: ["content.jsonld_validity"], explanation: "The local rule validates JSON-LD syntax but does not reproduce Ora's structured-data rubric." },
  { id: "pricing-info", name: "Pricing info accessible", essentialsTier: "recommended", mapping: "not_ported", localRuleIds: [], explanation: "The local audit does not classify pricing content." },
  { id: "public-api-docs", name: "Public API/docs linked from homepage", essentialsTier: "recommended", mapping: "not_ported", localRuleIds: [], explanation: "The local audit does not classify developer-documentation links." },
  { id: "json-ld-entity-linking", name: "JSON-LD entity linking (sameAs)", essentialsTier: "recommended", mapping: "equivalent", localRuleIds: ["content.entity_same_as"], explanation: "Both require a Person or Organization entity with a valid HTTPS sameAs URL." },
  { id: "metadata-completeness", name: "Metadata completeness", essentialsTier: "recommended", mapping: "composite", localRuleIds: ["technical.canonical", "content.language", "content.open_graph"], explanation: "Three local rules jointly cover canonical, language, og:type, and og:image." },
  { id: "trust-anchors", name: "Trust anchor pages", essentialsTier: "recommended", mapping: "partial", localRuleIds: ["technical.trust_pages"], explanation: "The local rule follows page links instead of probing Ora's fixed-path candidate set." },
  { id: "llms-txt-links-resolve", name: "llms.txt links resolve", essentialsTier: "emerging", mapping: "not_ported", localRuleIds: [], explanation: "The local llms.txt probe does not follow document links." },
  { id: "markdown-link-alternate", name: "Markdown alternate link", essentialsTier: "emerging", mapping: "not_ported", localRuleIds: [], explanation: "The local audit does not inspect markdown alternate links." },
  { id: "redirect-hygiene", name: "Redirect hygiene", essentialsTier: "required", mapping: "partial", localRuleIds: ["technical.redirect_hygiene"], explanation: "The local rule detects client-side redirect stubs but does not score cross-domain HTTP redirect depth." },
  { id: "page-token-budget", name: "Page token budget", essentialsTier: "recommended", mapping: "not_ported", localRuleIds: [], explanation: "The local audit enforces byte limits but does not score page token volume." },
  { id: "docs-auth-gate", name: "Content behind auth", essentialsTier: "required", mapping: "not_ported", localRuleIds: [], explanation: "The local audit does not identify or bypass documentation authentication gates." },
  { id: "markdown-negotiation", name: "Markdown agent docs", essentialsTier: "emerging", mapping: "partial", localRuleIds: ["technical.markdown_negotiation"], explanation: "The local rule tests Accept negotiation only and does not accept static /llms.md or .md paths." },
  { id: "markdown-negotiation-vary", name: "Markdown content negotiation (acceptmarkdown.com)", essentialsTier: "required", mapping: "partial", localRuleIds: ["technical.markdown_negotiation"], explanation: "The local rule checks text/markdown and Vary: Accept but does not reproduce Ora's broader scoring rubric." },
  { id: "agent-friendly-404", name: "Agent-friendly 404s", essentialsTier: "required", mapping: "partial", localRuleIds: ["technical.not_found_status"], explanation: "The local rule checks the HTTP status but not Ora's markdown guidance in the error body." },
  { id: "ax-document-structure", name: "Accessible document structure", essentialsTier: "required", mapping: "composite", localRuleIds: ["content.document_landmarks", "content.heading_structure"], explanation: "Landmark and heading findings jointly cover the measured document structure." },
  { id: "ax-native-controls", name: "Native interactive controls", essentialsTier: "required", mapping: "not_ported", localRuleIds: [], explanation: "Interactive-control semantics are not evaluated by this ruleset." },
  { id: "ax-accessible-names", name: "Accessible names on controls", essentialsTier: "required", mapping: "not_ported", localRuleIds: [], explanation: "Accessible control names are not evaluated by this ruleset." },
  { id: "ax-form-labeling", name: "Form control labeling", essentialsTier: "required", mapping: "not_ported", localRuleIds: [], explanation: "Form labeling is not evaluated by this ruleset." },
  { id: "ax-tree-injection-safe", name: "Accessibility-tree injection safety (bonus)", essentialsTier: "recommended", mapping: "not_ported", localRuleIds: [], explanation: "Prompt-injection analysis is outside the static readiness ruleset." },
  { id: "agent-crawler-reachability", name: "Agent crawler reachability", essentialsTier: "required", mapping: "not_ported", localRuleIds: [], explanation: "Not ported because the local audit does not impersonate ChatGPT-User, ClaudeBot, Google-Extended, or other crawler user agents." },
];
