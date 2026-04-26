/**
 * Fetch curated model data and write src/data/models.json.
 *
 * Two sources:
 *   1. Artificial Analysis JSON API → intelligence index, per-token prices.
 *   2. AA's website /models/<x> page (HTML) → cost-to-run on the eval suite
 *      AND per-variant end-to-end latency. The JSON API doesn't expose these.
 *
 * Run with: npm run fetch
 */
import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

config();

const API_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
const SCRAPE_URL = "https://artificialanalysis.ai/models/gpt-5-5-medium"; // any model page works
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "src", "data", "models.json");

// Curated set keyed by AA slug. The slug uniquely identifies the variant
// (reasoning level + effort), unlike model names which can be ambiguous.
// Edit freely.
const CURATED_SLUGS: { slug: string; displayName?: string }[] = [
  // OpenAI
  { slug: "gpt-5-5", displayName: "GPT-5.5 · xhigh" },
  { slug: "gpt-5-5-high", displayName: "GPT-5.5 · high" },
  { slug: "gpt-5-5-medium", displayName: "GPT-5.5 · medium" },
  { slug: "gpt-5-5-low", displayName: "GPT-5.5 · low" },
  { slug: "gpt-5-5-non-reasoning", displayName: "GPT-5.5 · base" },
  { slug: "gpt-5-4", displayName: "GPT-5.4 · xhigh" },
  { slug: "gpt-5-4-mini", displayName: "GPT-5.4 mini" },
  // Anthropic
  { slug: "claude-opus-4-7", displayName: "Claude Opus 4.7" },
  { slug: "claude-opus-4-7-non-reasoning", displayName: "Opus 4.7 · base" },
  { slug: "claude-sonnet-4-6-adaptive", displayName: "Claude Sonnet 4.6" },
  { slug: "claude-4-5-haiku-reasoning", displayName: "Claude 4.5 Haiku" },
  // Google
  { slug: "gemini-3-1-pro-preview", displayName: "Gemini 3.1 Pro" },
  { slug: "gemini-3-flash-reasoning", displayName: "Gemini 3 Flash" },
  { slug: "gemini-3-1-flash-lite-preview", displayName: "Gemini 3.1 Flash-Lite" },
  // xAI
  { slug: "grok-4-20", displayName: "Grok 4.20" },
  // Open weights / international frontier
  { slug: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
  { slug: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash" },
  { slug: "deepseek-v3-2-reasoning", displayName: "DeepSeek V3.2" },
  { slug: "qwen3-6-max", displayName: "Qwen3.6 Max" },
  { slug: "kimi-k2-6", displayName: "Kimi K2.6" },
  { slug: "glm-5-1", displayName: "GLM-5.1" },
  { slug: "llama-4-maverick", displayName: "Llama 4 Maverick" },
];

interface ScrapedRow {
  slug: string;
  costToRun: number; // USD to run the AA Intelligence Index eval suite
  e2eLatencyTotal: number; // input + reasoning + answer (seconds)
  e2eInputTime: number;
  e2eReasoningTime: number;
  e2eAnswerTime: number;
  intelligence?: number;
}

interface ApiModel {
  id: string;
  name: string;
  slug: string;
  model_creator?: { name?: string };
  evaluations?: { artificial_analysis_intelligence_index?: number };
  pricing?: { price_1m_blended_3_to_1?: number; price_1m_input_tokens?: number; price_1m_output_tokens?: number };
  median_output_tokens_per_second?: number;
  median_time_to_first_token_seconds?: number;
}

export interface Model {
  slug: string;
  name: string;
  displayName: string;
  creator: string;
  intelligence: number;
  // Cost to run the AA Intelligence Index eval suite, USD. Captures real token
  // usage (including reasoning tokens), unlike per-million blended price.
  costToRun: number;
  // End-to-end latency for one query, summed across input/reasoning/answer phases (s).
  e2eLatency: number;
  reasoningTime: number;
  // Per-token price (blended, 3:1) — kept for reference.
  pricePerMillion: number;
  outputTokensPerSecond: number;
  ttft: number;
}

function findAllRegex(text: string, re: RegExp): { index: number; match: RegExpExecArray }[] {
  const out: { index: number; match: RegExpExecArray }[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, match: m });
    if (m.index === re.lastIndex) re.lastIndex++; // avoid empty-match infinite loop
  }
  return out;
}

function scrapeModels(html: string): Map<string, ScrapedRow> {
  // The page embeds a streaming RSC payload with escaped JSON. Each model entry
  // has, in order: ...,"slug":"<slug>",...,"intelligence_index":<n>,...,
  // "end_to_end_response_time_metrics":{"input_time":...,"reasoning_time":...,
  // "answer_time":...,"total_time":...},"intelligence_index_cost":{"total_cost":<n>,...}
  //
  // Strategy: find every cost block. For each, walk back to the nearest preceding
  // slug (the model's own slug appears just before the cost block in the entry).
  // Validate by also picking up the e2e block in between.
  const slugRe = /\\"slug\\":\\"([a-z0-9\-]+)\\"/g;
  const costRe = /\\"intelligence_index_cost\\":\{\\"total_cost\\":([0-9.eE+\-]+)/g;
  const e2eRe = /\\"end_to_end_response_time_metrics\\":\{\\"input_time\\":([0-9.eE+\-]+),\\"reasoning_time\\":([0-9.eE+\-]+),\\"answer_time\\":([0-9.eE+\-]+),\\"total_time\\":([0-9.eE+\-]+)/g;
  const iiRe = /\\"intelligence_index\\":([0-9.eE+\-]+)/g;

  const slugs = findAllRegex(html, slugRe);
  const costs = findAllRegex(html, costRe);
  const e2es = findAllRegex(html, e2eRe);
  const iis = findAllRegex(html, iiRe);

  const result = new Map<string, ScrapedRow>();

  // For each cost, the entry's structure is: ..., "slug":"<model>", ...,
  // "model_creators":{..., "slug":"<creator>"}, ..., "intelligence_index_cost":...
  // So the model's own slug is the SECOND-TO-LAST slug before each cost; the
  // immediately-preceding slug is the creator's.
  for (const c of costs) {
    const before: string[] = [];
    for (const s of slugs) {
      if (s.index < c.index) before.push(s.match[1]);
      else break;
    }
    if (before.length < 2) continue;
    const lastSlug = before[before.length - 2];

    // The slug we just picked is the entry's slug only if there is no
    // *intervening* model entry boundary. In practice it works because every
    // entry contains its slug exactly once, just before the cost block.

    // Find the most recent e2e block before this cost (within the same entry).
    let lastE2e: { input: number; reasoning: number; answer: number; total: number } | null = null;
    for (const e of e2es) {
      if (e.index >= c.index) break;
      lastE2e = {
        input: parseFloat(e.match[1]),
        reasoning: parseFloat(e.match[2]),
        answer: parseFloat(e.match[3]),
        total: parseFloat(e.match[4]),
      };
    }

    // Most recent intelligence_index before this cost.
    let lastII: number | undefined;
    for (const i of iis) {
      if (i.index >= c.index) break;
      lastII = parseFloat(i.match[1]);
    }

    // First write wins (each entry's data appears once; later occurrences are
    // for other models and the slug walk-back will pair them correctly).
    if (!result.has(lastSlug)) {
      result.set(lastSlug, {
        slug: lastSlug,
        costToRun: parseFloat(c.match[1]),
        e2eLatencyTotal: lastE2e?.total ?? 0,
        e2eInputTime: lastE2e?.input ?? 0,
        e2eReasoningTime: lastE2e?.reasoning ?? 0,
        e2eAnswerTime: lastE2e?.answer ?? 0,
        intelligence: lastII,
      });
    }
  }

  return result;
}

async function main() {
  const apiKey = process.env.AA_API_KEY;
  if (!apiKey) throw new Error("AA_API_KEY missing in .env");

  console.log(`fetching API ${API_URL} ...`);
  const apiRes = await fetch(API_URL, { headers: { "x-api-key": apiKey } });
  if (!apiRes.ok) throw new Error(`API ${apiRes.status}: ${await apiRes.text()}`);
  const apiPayload = (await apiRes.json()) as ApiModel[] | { data?: ApiModel[] };
  const apiModels: ApiModel[] = Array.isArray(apiPayload)
    ? apiPayload
    : apiPayload.data ?? [];
  console.log(`got ${apiModels.length} models from API`);

  console.log(`scraping ${SCRAPE_URL} for cost-to-run + e2e latency ...`);
  const scrapeRes = await fetch(SCRAPE_URL);
  if (!scrapeRes.ok) throw new Error(`scrape ${scrapeRes.status}`);
  const html = await scrapeRes.text();
  const scraped = scrapeModels(html);
  console.log(`scraped ${scraped.size} model entries`);

  // Build slug → API entry index. Note: API "slug" is the parent model slug,
  // shared across reasoning variants. We need name-based matching for variants.
  // Strategy: use AA-page intelligence_index AND the API's slug+name to pair.

  const out: Model[] = [];
  const missing: string[] = [];
  for (const { slug, displayName } of CURATED_SLUGS) {
    const sc = scraped.get(slug);
    if (!sc) {
      missing.push(slug);
      continue;
    }
    // Try to match an API entry by intelligence (closest to scraped intelligence)
    // among entries whose API slug is a prefix of the AA slug. This pairs e.g.
    // AA slug "gpt-5-5-medium" with the API entry whose name contains "(medium)"
    // and slug starts with "gpt-5-5".
    const candidates = apiModels.filter((m) => slug.startsWith(m.slug));
    let api: ApiModel | undefined;
    if (sc.intelligence != null && candidates.length) {
      api = candidates.reduce<ApiModel | undefined>((best, m) => {
        const ii = m.evaluations?.artificial_analysis_intelligence_index;
        if (ii == null) return best;
        if (!best) return m;
        const bestII = best.evaluations?.artificial_analysis_intelligence_index ?? 0;
        return Math.abs(ii - sc.intelligence!) < Math.abs(bestII - sc.intelligence!) ? m : best;
      }, undefined);
    }

    out.push({
      slug,
      name: api?.name ?? displayName ?? slug,
      displayName: displayName ?? api?.name ?? slug,
      creator: api?.model_creator?.name ?? "Unknown",
      intelligence: sc.intelligence ?? api?.evaluations?.artificial_analysis_intelligence_index ?? 0,
      costToRun: sc.costToRun,
      e2eLatency: sc.e2eLatencyTotal,
      reasoningTime: sc.e2eReasoningTime,
      pricePerMillion: api?.pricing?.price_1m_blended_3_to_1 ?? 0,
      outputTokensPerSecond: api?.median_output_tokens_per_second ?? 0,
      ttft: api?.median_time_to_first_token_seconds ?? 0,
    });
  }

  if (missing.length) console.warn("[warn] missing slugs:", missing.join(", "));
  console.log(`built ${out.length} model rows`);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify({ fetchedAt: new Date().toISOString(), models: out }, null, 2),
  );
  console.log(`wrote ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
