import "dotenv/config";

export interface Config {
  ipedUrl: string;
  searchResultLimit: number;
  textLimit: number;
  contentLimit: number;
  auditLog?: string;
  investigationsDir: string;
  ipedCaseDir?: string;
  aiBaseUrl?: string;
  aiModel?: string;
  aiApiKey?: string;
}

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) return fallback;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function getConfig(): Config {
  const ipedUrl = process.env.IPED_URL ?? "http://127.0.0.1:8080";
  const url = new URL(ipedUrl);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("IPED_URL must be an HTTP or HTTPS URL");
  }

  return {
    ipedUrl: ipedUrl.replace(/\/$/, ""),
    searchResultLimit: positiveInteger("SEARCH_RESULT_LIMIT", 50),
    textLimit: positiveInteger("TEXT_LIMIT", 50_000),
    contentLimit: positiveInteger("CONTENT_LIMIT", 10_000_000),
    auditLog: process.env.AUDIT_LOG || "./audit/requests.jsonl",
    investigationsDir:
      process.env.INVESTIGATIONS_DIR || "./workspace/investigations",
    ipedCaseDir: process.env.IPED_CASE_DIR || undefined,
    aiBaseUrl: process.env.AI_BASE_URL,
    aiModel: process.env.AI_MODEL,
    aiApiKey: process.env.AI_API_KEY
  };
}