/**
 * Fetch model data and write src/data/models.json.
 *
 * Two sources:
 *   1. Artificial Analysis JSON API → intelligence index, per-token prices.
 *   2. AA's website /models/<x> page (HTML) → cost per Intelligence Index
 *      task AND per-variant end-to-end latency. The JSON API doesn't expose these.
 *
 * Run with: npm run fetch
 */
import { config } from "dotenv";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

config();

const API_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
const SCRAPE_URL = "https://artificialanalysis.ai/models/gpt-5-5-medium"; // any model page works
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_PATH = resolve(__dirname, "..");
const OUT_PATH = resolve(__dirname, "..", "src", "data", "models.json");
const SCREENSHOT_PATH = resolve(ROOT_PATH, "docs", "screenshot.png");
const SCREENSHOT_VIEWPORT = { width: 1600, height: 1000 };
const SCREENSHOT_DEVICE_SCALE = 2;

interface ModelSeed {
  slug: string;
  displayName?: string;
}

interface ScrapedRow {
  slug: string;
  displayName?: string;
  costPerTask?: number; // weighted average USD per AA Intelligence Index task
  pricePerMillion?: number;
  e2eLatencyTotal?: number; // input + reasoning + answer (seconds)
  e2eInputTime?: number;
  e2eReasoningTime?: number;
  e2eAnswerTime?: number;
  intelligence?: number;
}

interface ApiModel {
  id: string;
  name: string;
  slug: string;
  release_date?: string;
  model_creator?: { name?: string };
  evaluations?: {
    artificial_analysis_intelligence_index?: number;
    artificial_analysis_coding_index?: number;
  };
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
  // AA Coding Index (LiveCodeBench, SciCode, Terminal-Bench Hard, τ²-bench).
  // From the JSON API only — null when no API entry pairs with the AA slug.
  codingIndex: number | null;
  // Weighted average cost, USD, per AA Intelligence Index task.
  costPerTask: number | null;
  // End-to-end latency for one query, summed across input/reasoning/answer phases (s).
  e2eLatency: number | null;
  reasoningTime: number | null;
  // Per-token price (blended, 3:1) — kept for reference.
  pricePerMillion: number;
  outputTokensPerSecond: number;
  ttft: number;
  releaseDate?: string;
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
  // The page embeds a streaming RSC payload with escaped JSON. Some newly-added
  // models can have intelligence + latency before AA publishes eval-suite cost,
  // so parse per-model entries instead of anchoring every row on the cost block.
  const entryRe = /\{\\"additional_text\\":/g;
  const slugRe = /\\"slug\\":\\"([a-z0-9\-]+)\\"/;
  const shortNameRe = /\\"short_name\\":\\"([^\\"]+)\\"/;
  const costPerTaskRe = /\\"intelligenceIndexCostPerTask\\":\{\\"cost\\":\{\\"total\\":([0-9.eE+\-]+)/;
  const e2eRe = /\\"end_to_end_response_time_metrics\\":\{\\"input_time\\":([0-9.eE+\-]+),\\"reasoning_time\\":([0-9.eE+\-]+),\\"answer_time\\":([0-9.eE+\-]+),\\"total_time\\":([0-9.eE+\-]+)/;
  const iiRe = /\\"intelligence_index\\":([0-9.eE+\-]+)/;

  const entryStarts = findAllRegex(html, entryRe).map((entry) => entry.index);

  const result = new Map<string, ScrapedRow>();

  for (let i = 0; i < entryStarts.length; i += 1) {
    const start = entryStarts[i];
    const end = entryStarts[i + 1] ?? html.length;
    const entry = html.slice(start, end);
    const slug = entry.match(slugRe)?.[1];
    const e2e = entry.match(e2eRe);
    if (!slug || !e2e || result.has(slug)) continue;

    const costPerTask = entry.match(costPerTaskRe)?.[1];
    const intelligence = entry.match(iiRe)?.[1];
    const shortName = entry.match(shortNameRe)?.[1];
    result.set(slug, {
      slug,
      displayName: shortName == null ? undefined : decodeHtml(decodeJsonString(shortName)).replace(/\s+/g, " ").trim(),
      costPerTask: costPerTask == null ? undefined : parseFloat(costPerTask),
      e2eLatencyTotal: parseFloat(e2e[4]),
      e2eInputTime: parseFloat(e2e[1]),
      e2eReasoningTime: parseFloat(e2e[2]),
      e2eAnswerTime: parseFloat(e2e[3]),
      intelligence: intelligence == null ? undefined : parseFloat(intelligence),
    });
  }

  const ldScripts = findAllRegex(
    html,
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  );

  for (const { match } of ldScripts) {
    let dataset: { name?: string; data?: unknown[] };
    try {
      dataset = JSON.parse(match[1]);
    } catch {
      continue;
    }

    if (!Array.isArray(dataset.data)) continue;

    for (const item of dataset.data) {
      if (item == null || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const detailsUrl = typeof row.detailsUrl === "string" ? row.detailsUrl : "";
      const slug = detailsUrl.match(/^\/models\/([a-z0-9-]+)$/)?.[1];
      if (!slug) continue;

      const current = result.get(slug) ?? { slug };
      result.set(slug, current);

      if (typeof row.label === "string") {
        current.displayName = decodeHtml(row.label).replace(/\s+/g, " ").trim();
      }

      if (dataset.name === "Cost per Task" && typeof row.costPerIntelligenceIndexTask === "number") {
        current.costPerTask = row.costPerIntelligenceIndexTask;
      }

      if (dataset.name === "Cost per Intelligence Index Task" && current.costPerTask == null) {
        const answer = typeof row.answer === "number" ? row.answer : 0;
        const reasoning = typeof row.reasoning === "number" ? row.reasoning : 0;
        const cacheWrite = typeof row.cacheWrite === "number" ? row.cacheWrite : 0;
        const cacheHit = typeof row.cacheHit === "number" ? row.cacheHit : 0;
        const input = typeof row.input === "number" ? row.input : 0;
        const total = answer + reasoning + cacheWrite + cacheHit + input;
        if (positiveFinite(total)) current.costPerTask = total;
      }

      if (dataset.name === "Price" && typeof row.pricePerMillionTokens === "number") {
        current.pricePerMillion = row.pricePerMillionTokens;
      }

      if (dataset.name === "End-to-End Response Time") {
        const answer = typeof row.answerTime === "number" ? row.answerTime : 0;
        const reasoning = typeof row.reasoningTime === "number" ? row.reasoningTime : 0;
        const input = typeof row.inputTime === "number" ? row.inputTime : 0;
        const total = answer + reasoning + input;
        if (positiveFinite(total)) {
          current.e2eAnswerTime = answer;
          current.e2eReasoningTime = reasoning;
          current.e2eInputTime = input;
          current.e2eLatencyTotal = total;
        }
      }

      const intelligence =
        typeof row.artificialAnalysisIntelligenceIndex === "number"
          ? row.artificialAnalysisIntelligenceIndex
          : typeof row.intelligenceIndex === "number"
            ? row.intelligenceIndex
            : undefined;
      if (
        intelligence != null &&
        (dataset.name === "Intelligence" || dataset.name === "Artificial Analysis Intelligence Index")
      ) {
        current.intelligence = intelligence;
      }
    }
  }

  return result;
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeJsonString(text: string): string {
  try {
    return JSON.parse(`"${text}"`);
  } catch {
    return text;
  }
}

function buildModelSeeds(scraped: Map<string, ScrapedRow>, apiModels: ApiModel[]): ModelSeed[] {
  const apiBySlug = new Map(apiModels.map((model) => [model.slug, model]));
  const seeds = [...scraped.values()]
    .filter((row) => {
      const api = apiBySlug.get(row.slug);
      return Boolean(
        api &&
          positiveFinite(row.intelligence),
      );
    })
    .map((row) => ({
      slug: row.slug,
      displayName: row.displayName ?? apiBySlug.get(row.slug)?.name ?? row.slug,
    }))
    .sort((a, b) => {
      const ai = scraped.get(a.slug)?.intelligence ?? 0;
      const bi = scraped.get(b.slug)?.intelligence ?? 0;
      return bi - ai || a.slug.localeCompare(b.slug);
    });

  console.log(`discovered ${seeds.length} live model slugs with API + intelligence metrics`);
  return seeds;
}

function positiveFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function warnList(label: string, rows: string[], limit = 30): void {
  if (!rows.length) return;
  const sample = rows.slice(0, limit).join(", ");
  const suffix = rows.length > limit ? `, ... +${rows.length - limit} more` : "";
  console.warn(`[warn] ${label} (${rows.length}): ${sample}${suffix}`);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT_PATH, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function ensurePlaywrightChromium(): Promise<void> {
  if (existsSync(chromium.executablePath())) return;
  console.log("installing Playwright Chromium for headless screenshots ...");
  await runCommand("npx", ["playwright", "install", "chromium"]);
}

function builtHtmlForScreenshot(): string {
  let html = readFileSync(resolve(ROOT_PATH, "dist", "index.html"), "utf8");

  html = html.replace(
    /<link[^>]+rel="stylesheet"[^>]+href="\.?\/?([^"]+)"[^>]*>/g,
    (tag, href: string) =>
      /^https?:/.test(href)
        ? tag
        : `<style>${readFileSync(resolve(ROOT_PATH, "dist", href), "utf8")}</style>`,
  );

  html = html.replace(
    /<script[^>]+type="module"[^>]+src="\.?\/?([^"]+)"[^>]*><\/script>/g,
    (tag, src: string) =>
      /^https?:/.test(src)
        ? tag
        : `<script type="module">${readFileSync(resolve(ROOT_PATH, "dist", src), "utf8")}</script>`,
  );

  return html;
}

async function captureScreenshot(outPath: string): Promise<void> {
  mkdirSync(dirname(outPath), { recursive: true });
  await ensurePlaywrightChromium();
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-sync",
      "--hide-scrollbars",
      "--no-default-browser-check",
      "--no-first-run",
    ],
  });

  try {
    const page = await browser.newPage({
      viewport: SCREENSHOT_VIEWPORT,
      deviceScaleFactor: SCREENSHOT_DEVICE_SCALE,
    });
    await page.setContent(builtHtmlForScreenshot(), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector("svg", { timeout: 10_000 });
    await page.screenshot({
      path: outPath,
      fullPage: false,
    });
  } finally {
    await browser.close();
  }
}

function openScreenshot(outPath: string): Promise<void> {
  if (process.env.CI || process.platform !== "darwin") {
    console.log(`open ${outPath} to view the screenshot`);
    return Promise.resolve();
  }

  return new Promise((resolvePromise) => {
    const child = spawn("open", [outPath], { stdio: "ignore" });
    child.on("error", (error) => {
      console.warn("[warn] could not open screenshot:", error);
      resolvePromise();
    });
    child.on("exit", (code) => {
      if (code === 0) console.log("opened screenshot");
      else console.warn(`[warn] could not open screenshot, open exited with ${code}`);
      resolvePromise();
    });
  });
}

async function refreshScreenshot(): Promise<void> {
  console.log("building app for screenshot ...");
  await runCommand("npm", ["run", "build", "--", "--base=./"]);

  console.log(`capturing screenshot ${SCREENSHOT_PATH} ...`);
  await captureScreenshot(SCREENSHOT_PATH);
  console.log(`wrote ${SCREENSHOT_PATH}`);
  await openScreenshot(SCREENSHOT_PATH);
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

  console.log(`scraping ${SCRAPE_URL} for cost per task + e2e response time ...`);
  const scrapeRes = await fetch(SCRAPE_URL);
  if (!scrapeRes.ok) throw new Error(`scrape ${scrapeRes.status}`);
  const html = await scrapeRes.text();
  const scraped = scrapeModels(html);
  console.log(`scraped ${scraped.size} model entries`);
  const modelSeeds = buildModelSeeds(scraped, apiModels);

  const apiBySlug = new Map(apiModels.map((model) => [model.slug, model]));

  const out: Model[] = [];
  const missing: string[] = [];
  const invalid: string[] = [];
  const missingApi: string[] = [];
  const missingCost: string[] = [];
  for (const { slug, displayName } of modelSeeds) {
    const sc = scraped.get(slug);
    if (!sc) {
      missing.push(slug);
      continue;
    }
    const badFields = [
      positiveFinite(sc.intelligence) ? null : "intelligence",
    ].filter((field): field is string => field !== null);

    if (badFields.length) {
      invalid.push(`${slug} (${badFields.join(", ")})`);
      continue;
    }

    const api = apiBySlug.get(slug);
    if (!api) {
      missingApi.push(slug);
      continue;
    }

    out.push({
      slug,
      name: api.name,
      displayName: displayName ?? api.name,
      creator: api.model_creator?.name ?? "Unknown",
      intelligence: sc.intelligence ?? api.evaluations?.artificial_analysis_intelligence_index ?? 0,
      codingIndex: api.evaluations?.artificial_analysis_coding_index ?? null,
      costPerTask: positiveFinite(sc.costPerTask) ? sc.costPerTask : null,
      e2eLatency: positiveFinite(sc.e2eLatencyTotal) ? sc.e2eLatencyTotal : null,
      reasoningTime: sc.e2eReasoningTime ?? null,
      pricePerMillion: sc.pricePerMillion ?? api.pricing?.price_1m_blended_3_to_1 ?? 0,
      outputTokensPerSecond: api.median_output_tokens_per_second ?? 0,
      ttft: api.median_time_to_first_token_seconds ?? 0,
      releaseDate: api.release_date,
    });
    if (!positiveFinite(sc.costPerTask)) missingCost.push(slug);
  }

  const missingCoding = out.filter((m) => !positiveFinite(m.codingIndex ?? undefined)).map((m) => m.slug);
  const missingLatency = out.filter((m) => !positiveFinite(m.e2eLatency ?? undefined)).map((m) => m.slug);
  warnList("rows without coding index", missingCoding);
  warnList("rows without end-to-end response time", missingLatency);
  warnList("rows without exact API match", missingApi);
  warnList("missing slugs", missing);
  warnList("skipped rows with invalid chart metrics", invalid);
  warnList("rows without cost per task", missingCost);
  console.log(`built ${out.length} model rows`);

  const fetchedAt = new Date().toISOString();

  // First-seen tracking: keep each model's original addedAt, stamp newly seen
  // slugs with this run's timestamp. Drives the "newest model" highlight in the
  // UI — a model is flagged new from the refresh that first introduces it.
  //
  // Prior dates come from two sources: a small committed bootstrap map
  // (first-seen.json) so the highlight works on the very first deploy, and the
  // existing models.json (gitignored, hydrated from the live site in CI) which
  // carries the accumulated history and takes precedence over the bootstrap.
  let prior: Record<string, string> = {};
  const SEED_PATH = resolve(__dirname, "first-seen.json");
  if (existsSync(SEED_PATH)) {
    try {
      Object.assign(prior, JSON.parse(readFileSync(SEED_PATH, "utf8")) as Record<string, string>);
    } catch {
      console.warn("[warn] could not read first-seen.json bootstrap map");
    }
  }
  if (existsSync(OUT_PATH)) {
    try {
      const old = JSON.parse(readFileSync(OUT_PATH, "utf8")) as {
        models?: { slug: string; addedAt?: string }[];
      };
      for (const m of old.models ?? []) if (m.addedAt) prior[m.slug] = m.addedAt;
    } catch {
      console.warn("[warn] could not read prior models.json for addedAt tracking");
    }
  }
  const stamped = out.map((m) => ({ ...m, addedAt: prior[m.slug] ?? m.releaseDate ?? fetchedAt }));
  const fresh = stamped.filter((m) => m.addedAt === fetchedAt).map((m) => m.slug);
  if (fresh.length) console.log(`newly added this run: ${fresh.join(", ")}`);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({ fetchedAt, models: stamped }, null, 2));
  console.log(`wrote ${OUT_PATH}`);

  if (process.env.SKIP_SCREENSHOT) {
    console.log("SKIP_SCREENSHOT set — skipping screenshot refresh");
    return;
  }
  await refreshScreenshot();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
