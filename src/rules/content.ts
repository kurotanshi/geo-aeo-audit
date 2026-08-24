import { parse, type DefaultTreeAdapterTypes } from "parse5";
import type { EvidenceKind, Finding, RuleResult } from "../schema/result.js";

type Node = DefaultTreeAdapterTypes.Node;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type Element = DefaultTreeAdapterTypes.Element;

export interface ContentAuditInput {
  url: string;
  body?: Buffer | string;
  unavailableReason?: string;
}

export interface ContentAuditResult {
  findings: Finding[];
}

type Category = "parseability" | "source_and_evidence" | "freshness_and_entity";
type Severity = "info" | "warning" | "error";

interface FindingFields {
  severity: Severity;
  category: Category;
  evidence: string[];
  rationale: string;
  recommendation: string;
  evidence_kind: EvidenceKind;
  claim_scope: string[];
  source_url?: string;
}

interface JsonLdAnalysis {
  blockCount: number;
  errors: string[];
  entities: Record<string, unknown>[];
}

const ARTICLE_TYPES = new Set([
  "article",
  "newsarticle",
  "blogposting",
  "techarticle",
  "report",
  "scholarlyarticle",
  "analysisnewsarticle",
  "opinionnewsarticle",
  "reviewnewsarticle",
]);

const CONTENT_RULES: readonly { id: string; category: Category }[] = [
  { id: "content.title", category: "parseability" },
  { id: "content.meta_description", category: "parseability" },
  { id: "content.language", category: "parseability" },
  { id: "content.heading_structure", category: "parseability" },
  { id: "content.jsonld_validity", category: "parseability" },
  { id: "content.article_structured_data", category: "parseability" },
  { id: "content.author", category: "freshness_and_entity" },
  { id: "content.publication_date", category: "freshness_and_entity" },
  { id: "content.entity_identity", category: "freshness_and_entity" },
  { id: "content.update_signal", category: "freshness_and_entity" },
  { id: "content.source_links", category: "source_and_evidence" },
];

/** Inspect static page content and emit evidence-complete findings without network access. */
export function auditPageContent(input: ContentAuditInput): ContentAuditResult {
  if (input.body === undefined) {
    return { findings: unavailableFindings(input.url, input.unavailableReason ?? "page_content_unavailable") };
  }

  const html = typeof input.body === "string" ? input.body : input.body.toString("utf8");
  const document = parse(html);
  const findings: Finding[] = [];
  const jsonLd = analyzeJsonLd(document);
  const articleEntity = jsonLd.entities.find((entity) => hasType(entity, ARTICLE_TYPES));
  const articleLike =
    articleEntity !== undefined ||
    findElements(document, "article").length > 0 ||
    metaValues(document, "property", "og:type").some((value) => value.toLowerCase() === "article");

  auditTitle(document, findings);
  auditDescription(document, findings);
  auditLanguage(document, findings);
  auditHeadings(document, findings);
  auditJsonLd(jsonLd, findings);
  auditArticleStructuredData(articleLike, articleEntity, jsonLd, findings);
  auditAuthor(document, articleLike, articleEntity, findings);
  auditPublicationDate(document, articleLike, articleEntity, findings);
  auditEntityIdentity(articleLike, jsonLd.entities, findings);
  auditUpdateSignal(document, articleLike, articleEntity, findings);
  auditSourceLinks(document, input.url, articleLike, articleEntity, findings);
  return { findings };
}

function auditTitle(document: ParentNode, findings: Finding[]): void {
  const titles = findElements(document, "title").map(textContent).map(cleanText).filter(Boolean);
  const ok = titles.length === 1;
  findings.push(
    finding("content.title", ok ? "pass" : "fail", {
      severity: ok ? "info" : "warning",
      category: "parseability",
      evidence: titles.length === 0 ? ["No non-empty title element was found."] : [`Title elements: ${titles.join(" | ")}`],
      rationale: ok
        ? "The page has one descriptive-title input available to consumers."
        : titles.length === 0
          ? "The page lacks a non-empty title element."
          : "Multiple title elements make the preferred page title ambiguous.",
      recommendation: ok ? "No change required." : "Provide exactly one concise, descriptive title element.",
      evidence_kind: "official_recommendation",
      claim_scope: ["google_search"],
      source_url: "https://developers.google.com/search/docs/appearance/title-link",
    }),
  );
}

function auditDescription(document: ParentNode, findings: Finding[]): void {
  const values = metaValues(document, "name", "description").map(cleanText).filter(Boolean);
  const ok = values.length === 1;
  findings.push(
    finding("content.meta_description", ok ? "pass" : "fail", {
      severity: ok ? "info" : "warning",
      category: "parseability",
      evidence: values.length === 0 ? ["No non-empty meta description was found."] : [`Meta descriptions: ${values.join(" | ")}`],
      rationale: ok
        ? "The page supplies one summary that Google may use when it better describes the page."
        : "The page does not supply one unambiguous meta description.",
      recommendation: ok ? "No change required." : "Provide one page-specific, useful meta description.",
      evidence_kind: "official_recommendation",
      claim_scope: ["google_search"],
      source_url: "https://developers.google.com/search/docs/appearance/snippet",
    }),
  );
}

function auditLanguage(document: ParentNode, findings: Finding[]): void {
  const htmlElement = findElements(document, "html")[0];
  const language = htmlElement === undefined ? undefined : attribute(htmlElement, "lang")?.trim();
  const valid = language !== undefined && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language);
  findings.push(
    finding("content.language", valid ? "pass" : "fail", {
      severity: valid ? "info" : "warning",
      category: "parseability",
      evidence: [language === undefined || language === "" ? "The html element has no lang value." : `html lang=${language}`],
      rationale: valid ? "The document declares a syntactically plausible language tag." : "The document language is absent or malformed.",
      recommendation: valid ? "No change required." : "Set html lang to the primary content language using a valid language tag.",
      evidence_kind: "standard",
      claim_scope: ["html_consumers"],
      source_url: "https://html.spec.whatwg.org/multipage/dom.html#attr-lang",
    }),
  );
}

function auditHeadings(document: ParentNode, findings: Finding[]): void {
  const headings = findElements(document).filter((element) => /^h[1-6]$/.test(element.tagName));
  const observed = headings.map((element) => ({ level: Number(element.tagName[1]), text: cleanText(textContent(element)) }));
  const nonEmpty = observed.filter((heading) => heading.text !== "");
  let valid = nonEmpty.length > 0 && nonEmpty[0]?.level === 1;
  for (let index = 1; index < nonEmpty.length; index += 1) {
    if (nonEmpty[index]!.level > nonEmpty[index - 1]!.level + 1) valid = false;
  }
  findings.push(
    finding("content.heading_structure", valid ? "pass" : "fail", {
      severity: valid ? "info" : "warning",
      category: "parseability",
      evidence: nonEmpty.length === 0
        ? ["No non-empty headings were found."]
        : [nonEmpty.map((heading) => `h${heading.level}:${heading.text}`).join(" | ")],
      rationale: valid
        ? "The static HTML exposes a primary heading without skipped hierarchy levels."
        : "The static heading outline has no primary h1 or skips a hierarchy level.",
      recommendation: valid ? "No change required." : "Expose a clear h1 and use heading levels in a coherent hierarchy.",
      evidence_kind: "heuristic",
      claim_scope: ["static_html_readability"],
    }),
  );
}

function auditJsonLd(jsonLd: JsonLdAnalysis, findings: Finding[]): void {
  const result: RuleResult = jsonLd.blockCount === 0 ? "not_applicable" : jsonLd.errors.length > 0 ? "error" : "pass";
  findings.push(
    finding("content.jsonld_validity", result, {
      severity: result === "error" ? "error" : "info",
      category: "parseability",
      evidence: jsonLd.blockCount === 0
        ? ["No JSON-LD blocks were present."]
        : jsonLd.errors.length > 0
          ? jsonLd.errors
          : [`Parsed ${jsonLd.blockCount} JSON-LD block(s) and observed ${jsonLd.entities.length} object(s).`],
      rationale: result === "error"
        ? "At least one JSON-LD block could not be parsed, which is a measurement error rather than a failed content claim."
        : result === "pass"
          ? "The observed JSON-LD is syntactically valid JSON."
          : "JSON-LD syntax is not applicable because none was supplied.",
      recommendation: result === "error" ? "Correct invalid JSON-LD syntax and rerun the audit." : "No change required.",
      evidence_kind: "standard",
      claim_scope: ["web_structured_data"],
      source_url: "https://www.w3.org/TR/json-ld11/",
    }),
  );
}

function auditArticleStructuredData(
  articleLike: boolean,
  articleEntity: Record<string, unknown> | undefined,
  jsonLd: JsonLdAnalysis,
  findings: Finding[],
): void {
  const result: RuleResult = !articleLike
    ? "not_applicable"
    : articleEntity !== undefined
      ? "pass"
      : jsonLd.errors.length > 0
        ? "error"
        : "fail";
  findings.push(
    finding("content.article_structured_data", result, {
      severity: result === "fail" || result === "error" ? "warning" : "info",
      category: "parseability",
      evidence: [
        articleEntity !== undefined
          ? `Article type: ${typeNames(articleEntity).join(", ")}`
          : articleLike
            ? "Article-like HTML was observed without a parsed Article JSON-LD entity."
            : "The page was not classified as an article.",
      ],
      rationale: result === "not_applicable"
        ? "Article structured data is not applicable to this page classification."
        : result === "pass"
          ? "The page provides an Article-family JSON-LD entity."
          : result === "error"
            ? "Invalid JSON-LD prevents a reliable Article-entity determination."
            : "An article-like page does not provide an Article-family JSON-LD entity.",
      recommendation: result === "fail" ? "Add accurate Article JSON-LD when the page is an article." : "No change required.",
      evidence_kind: "official_recommendation",
      claim_scope: ["google_search_article_rich_results"],
      source_url: "https://developers.google.com/search/docs/appearance/structured-data/article",
    }),
  );
}

function auditAuthor(
  document: ParentNode,
  articleLike: boolean,
  articleEntity: Record<string, unknown> | undefined,
  findings: Finding[],
): void {
  const structured = articleEntity === undefined ? [] : entityNames(articleEntity.author);
  const metadata = [
    ...metaValues(document, "name", "author"),
    ...metaValues(document, "property", "article:author"),
    ...findElements(document).filter((element) => tokenAttribute(element, "rel", "author")).map(textContent),
    ...findElements(document)
      .filter((element) => /(?:^|\s)(?:author|byline)(?:\s|$)/i.test(attribute(element, "class") ?? ""))
      .map(textContent),
  ].map(cleanText).filter(Boolean);
  const names = [...new Set([...structured, ...metadata])];
  const result: RuleResult = !articleLike ? "not_applicable" : names.length > 0 ? "pass" : "fail";
  findings.push(
    finding("content.author", result, {
      severity: result === "fail" ? "warning" : "info",
      category: "freshness_and_entity",
      evidence: [names.length > 0 ? `Observed author signals: ${names.join(", ")}` : "No author signal was observed."],
      rationale: result === "not_applicable"
        ? "Article author guidance is not applicable to this page classification."
        : result === "pass"
          ? "The article exposes at least one author signal in static HTML or JSON-LD."
          : "The article has no observable author signal.",
      recommendation: result === "fail" ? "Identify the article author and keep visible and structured author data consistent." : "No change required.",
      evidence_kind: "official_recommendation",
      claim_scope: ["google_search_article_rich_results"],
      source_url: "https://developers.google.com/search/docs/appearance/structured-data/article#author-markup-best-practices",
    }),
  );
}

function auditPublicationDate(
  document: ParentNode,
  articleLike: boolean,
  articleEntity: Record<string, unknown> | undefined,
  findings: Finding[],
): void {
  const values = [
    ...scalarStrings(articleEntity?.datePublished),
    ...metaValues(document, "property", "article:published_time"),
    ...findElements(document, "time")
      .filter((element) => /(?:^|\s)(?:published|publication)(?:\s|$)/i.test(attribute(element, "class") ?? ""))
      .map((element) => attribute(element, "datetime") ?? textContent(element)),
  ].map(cleanText).filter(Boolean);
  const valid = values.filter(isIsoDate);
  const result: RuleResult = !articleLike ? "not_applicable" : valid.length > 0 ? "pass" : "fail";
  findings.push(
    finding("content.publication_date", result, {
      severity: result === "fail" ? "warning" : "info",
      category: "freshness_and_entity",
      evidence: [values.length === 0 ? "No publication date was observed." : `Publication date signals: ${values.join(", ")}`],
      rationale: result === "not_applicable"
        ? "Article publication-date guidance is not applicable to this page classification."
        : result === "pass"
          ? "The article exposes a syntactically valid publication date."
          : "The article lacks a valid ISO 8601 publication-date signal.",
      recommendation: result === "fail" ? "Provide an accurate visible date and datePublished structured value." : "No change required.",
      evidence_kind: "official_recommendation",
      claim_scope: ["google_search"],
      source_url: "https://developers.google.com/search/docs/appearance/publication-dates",
    }),
  );
}

function auditEntityIdentity(
  articleLike: boolean,
  entities: Record<string, unknown>[],
  findings: Finding[],
): void {
  const identityEntities = entities.filter((entity) => hasAnyType(entity, new Set(["person", "organization"])));
  const profileLike = entities.some((entity) => hasAnyType(entity, new Set(["profilepage"])));
  const applicable = articleLike || profileLike || identityEntities.length > 0;
  const named = identityEntities.flatMap((entity) => scalarStrings(entity.name)).map(cleanText).filter(Boolean);
  const result: RuleResult = !applicable ? "not_applicable" : identityEntities.length > 0 && named.length > 0 ? "pass" : "fail";
  findings.push(
    finding("content.entity_identity", result, {
      severity: result === "fail" ? "warning" : "info",
      category: "freshness_and_entity",
      evidence: [named.length > 0 ? `Named Person/Organization entities: ${[...new Set(named)].join(", ")}` : "No named Person or Organization entity was observed."],
      rationale: result === "not_applicable"
        ? "Person/Organization identity guidance is not applicable to this page classification."
        : result === "pass"
          ? "The JSON-LD identifies a named Person or Organization entity."
          : "An applicable article or profile page does not expose a named Person or Organization entity in JSON-LD.",
      recommendation: result === "fail" ? "Use accurate Person or Organization entities for applicable authors and publishers." : "No change required.",
      evidence_kind: "official_recommendation",
      claim_scope: ["google_search_structured_data"],
      source_url: "https://developers.google.com/search/docs/appearance/structured-data/profile-page",
    }),
  );
}

function auditUpdateSignal(
  document: ParentNode,
  articleLike: boolean,
  articleEntity: Record<string, unknown> | undefined,
  findings: Finding[],
): void {
  const values = [
    ...scalarStrings(articleEntity?.dateModified),
    ...metaValues(document, "property", "article:modified_time"),
    ...findElements(document, "time")
      .filter((element) => /(?:updated|modified)/i.test(`${attribute(element, "class") ?? ""} ${attribute(element, "id") ?? ""}`))
      .map((element) => attribute(element, "datetime") ?? textContent(element)),
  ].map(cleanText).filter(Boolean);
  const valid = values.filter(isIsoDate);
  const result: RuleResult = !articleLike ? "not_applicable" : valid.length > 0 ? "pass" : "fail";
  findings.push(
    finding("content.update_signal", result, {
      severity: result === "fail" ? "warning" : "info",
      category: "freshness_and_entity",
      evidence: [values.length === 0 ? "No update-date signal was observed." : `Update signals: ${values.join(", ")}`],
      rationale: result === "not_applicable"
        ? "Article update guidance is not applicable to this page classification."
        : result === "pass"
          ? "The article exposes a valid last-modified signal."
          : "No valid last-modified signal was observed; this does not prove that the content is stale.",
      recommendation: result === "fail" ? "When the article changes materially, expose an accurate visible date and dateModified value." : "No change required.",
      evidence_kind: "official_recommendation",
      claim_scope: ["google_search"],
      source_url: "https://developers.google.com/search/docs/appearance/publication-dates",
    }),
  );
}

function auditSourceLinks(
  document: ParentNode,
  pageUrl: string,
  articleLike: boolean,
  articleEntity: Record<string, unknown> | undefined,
  findings: Finding[],
): void {
  const containers = findElements(document, "article");
  const linkRoot: ParentNode = containers[0] ?? findElements(document, "main")[0] ?? document;
  const pageOrigin = new URL(pageUrl).origin;
  const external = new Set<string>();
  for (const anchor of findElements(linkRoot, "a")) {
    const href = attribute(anchor, "href");
    if (href === undefined) continue;
    try {
      const target = new URL(href, pageUrl);
      if ((target.protocol === "http:" || target.protocol === "https:") && target.origin !== pageOrigin) {
        target.hash = "";
        external.add(target.toString());
      }
    } catch {
      // Invalid links are outside this signal; report generation will encode them.
    }
  }
  for (const value of [...scalarStrings(articleEntity?.citation), ...scalarStrings(articleEntity?.isBasedOn)]) {
    try {
      const target = new URL(value, pageUrl);
      if ((target.protocol === "http:" || target.protocol === "https:") && target.origin !== pageOrigin) {
        target.hash = "";
        external.add(target.toString());
      }
    } catch {
      // Ignore invalid structured citation URLs for this heuristic.
    }
  }
  const result: RuleResult = !articleLike ? "not_applicable" : external.size > 0 ? "pass" : "fail";
  findings.push(
    finding("content.source_links", result, {
      severity: result === "fail" ? "warning" : "info",
      category: "source_and_evidence",
      evidence: [external.size > 0 ? `External source links: ${[...external].slice(0, 5).join(", ")}` : "No external source link was observed in article content."],
      rationale: result === "not_applicable"
        ? "The article-source heuristic is not applicable to this page classification."
        : result === "pass"
          ? "The article exposes at least one externally resolvable source link."
          : "No external source link was observed; this is a transparency signal, not a universal ranking requirement.",
      recommendation: result === "fail" ? "Link primary sources where claims rely on external evidence and where doing so helps readers." : "No change required.",
      evidence_kind: "heuristic",
      claim_scope: ["article_source_transparency"],
    }),
  );
}

function analyzeJsonLd(document: ParentNode): JsonLdAnalysis {
  const scripts = findElements(document, "script").filter(
    (element) => (attribute(element, "type") ?? "").trim().toLowerCase() === "application/ld+json",
  );
  const errors: string[] = [];
  const entities: Record<string, unknown>[] = [];
  scripts.forEach((script, index) => {
    try {
      collectObjects(JSON.parse(textContent(script)) as unknown, entities);
    } catch (error) {
      errors.push(`JSON-LD block ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { blockCount: scripts.length, errors, entities };
}

function collectObjects(value: unknown, output: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectObjects(item, output));
    return;
  }
  if (value === null || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  output.push(object);
  Object.values(object).forEach((item) => collectObjects(item, output));
}

function unavailableFindings(url: string, reason: string): Finding[] {
  return CONTENT_RULES.map(({ id, category }) =>
    finding(id, "not_tested", {
      severity: "warning",
      category,
      evidence: [`${url}: ${reason}`],
      rationale: "Static page content was not available for this rule.",
      recommendation: "Resolve the measurement limitation and rerun the audit.",
      evidence_kind: "empirical_observation",
      claim_scope: [],
    }),
  );
}

function findElements(root: ParentNode, tagName?: string): Element[] {
  const found: Element[] = [];
  const visit = (node: Node): void => {
    if (isElement(node) && (tagName === undefined || node.tagName === tagName)) found.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
    if (isElement(node) && node.tagName === "template") {
      (node as DefaultTreeAdapterTypes.Template).content.childNodes.forEach(visit);
    }
  };
  root.childNodes.forEach(visit);
  return found;
}

function isElement(node: Node): node is Element {
  return "tagName" in node && "attrs" in node;
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}

function tokenAttribute(element: Element, name: string, token: string): boolean {
  return (attribute(element, name) ?? "").toLowerCase().split(/\s+/).includes(token.toLowerCase());
}

function textContent(node: Node): string {
  if (node.nodeName === "#text") return (node as DefaultTreeAdapterTypes.TextNode).value;
  if ("childNodes" in node) return node.childNodes.map(textContent).join("");
  return "";
}

function metaValues(document: ParentNode, key: "name" | "property", value: string): string[] {
  return findElements(document, "meta")
    .filter((element) => (attribute(element, key) ?? "").toLowerCase() === value.toLowerCase())
    .map((element) => attribute(element, "content") ?? "");
}

function typeNames(entity: Record<string, unknown>): string[] {
  return scalarStrings(entity["@type"]);
}

function hasType(entity: Record<string, unknown>, types: Set<string>): boolean {
  return hasAnyType(entity, types);
}

function hasAnyType(entity: Record<string, unknown>, types: Set<string>): boolean {
  return typeNames(entity).some((name) => types.has(name.toLowerCase()));
}

function entityNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(entityNames);
  if (value !== null && typeof value === "object") return scalarStrings((value as Record<string, unknown>).name);
  return scalarStrings(value);
}

function scalarStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(scalarStrings);
  return [];
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value) && !Number.isNaN(Date.parse(value));
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function finding(id: string, result: RuleResult, fields: FindingFields): Finding {
  return { id, result, ...fields };
}
