import type { AiModelConfig } from "./types.js";

export const ZHONGKEY_BASE_URL = "https://zhongkey.com/v1";
export const ZHONGKEY_GUIDE_URL = "https://zhongkey.com/guide";

export interface ZhongkeyTokenUsage {
  name: string;
  totalGranted: number;
  totalUsed: number;
  totalAvailable: number;
  unlimitedQuota: boolean;
  modelLimits: string[];
  modelLimitsEnabled: boolean;
  expiresAt: number;
}

export interface ZhongkeyModel {
  id: string;
  description: string;
  protocols: string[];
  groups: string[];
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function safeBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function safeUpstreamMessage(value: unknown) {
  return String(value || "")
    .replace(/sk-[0-9A-Za-z._-]+/gu, "[密钥已隐藏]")
    .replace(/Bearer\s+[^\s,;]+/giu, "Bearer [密钥已隐藏]")
    .slice(0, 160);
}

export function zhongkeyApiRoot(baseUrl = ZHONGKEY_BASE_URL) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || !["zhongkey.com", "www.zhongkey.com"].includes(url.hostname.toLocaleLowerCase())) {
    throw new Error("中科云模型池只允许连接 zhongkey.com 官方 HTTPS 地址");
  }
  url.hostname = "zhongkey.com";
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/u, "").replace(/\/v1$/iu, "") || "/";
  return url.toString().replace(/\/$/u, "");
}

async function jsonResponse(response: globalThis.Response, label: string) {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label}返回了无法识别的数据`);
  }
  if (!response.ok) {
    const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const message = safeUpstreamMessage(root.message || (root.error && typeof root.error === "object" ? (root.error as Record<string, unknown>).message : ""));
    if ([401, 403].includes(response.status)) throw new Error("中科云 Key 无效或已经失效");
    throw new Error(message ? `${label}失败：${message.slice(0, 160)}` : `${label}失败（HTTP ${response.status}）`);
  }
  return payload;
}

export async function fetchZhongkeyTokenUsage(
  apiKey: string,
  baseUrl = ZHONGKEY_BASE_URL,
  fetcher: typeof fetch = fetch
): Promise<ZhongkeyTokenUsage> {
  if (!apiKey.trim()) throw new Error("请填写中科云 API Key");
  const response = await fetcher(`${zhongkeyApiRoot(baseUrl)}/api/usage/token`, {
    method: "GET",
    signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${apiKey.trim()}` }
  });
  const payload = await jsonResponse(response, "中科云额度查询") as Record<string, unknown>;
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;
  const modelLimitsValue = data.model_limits;
  const modelLimits = Array.isArray(modelLimitsValue)
    ? modelLimitsValue.map(String)
    : modelLimitsValue && typeof modelLimitsValue === "object"
      ? Object.entries(modelLimitsValue as Record<string, unknown>).filter(([, enabled]) => Boolean(enabled)).map(([model]) => model)
      : [];
  return {
    name: String(data.name || "中科云令牌"),
    totalGranted: safeNumber(data.total_granted),
    totalUsed: safeNumber(data.total_used),
    totalAvailable: safeNumber(data.total_available),
    unlimitedQuota: safeBoolean(data.unlimited_quota),
    modelLimits,
    modelLimitsEnabled: safeBoolean(data.model_limits_enabled),
    expiresAt: safeNumber(data.expires_at)
  };
}

export async function fetchZhongkeyModels(
  fetcher: typeof fetch = fetch
): Promise<ZhongkeyModel[]> {
  const response = await fetcher(`${zhongkeyApiRoot()}/api/pricing`, { method: "GET", signal: AbortSignal.timeout(15_000) });
  const payload = await jsonResponse(response, "中科云模型目录") as Record<string, unknown>;
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const id = String(item.model_name || "").trim();
    if (!id) return [];
    return [{
      id,
      description: String(item.description || "").trim(),
      protocols: Array.isArray(item.supported_endpoint_types) ? item.supported_endpoint_types.map(String) : [],
      groups: Array.isArray(item.enable_groups) ? item.enable_groups.map(String) : []
    }];
  }).filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
}

export function applyZhongkeyUsage(config: AiModelConfig, usage: ZhongkeyTokenUsage, at = new Date().toISOString()) {
  const granted = usage.totalGranted;
  const used = granted > 0
    ? Math.min(granted, Math.max(0, usage.totalUsed || granted - usage.totalAvailable))
    : 0;
  config.upstreamUsageRatio = usage.unlimitedQuota ? 0 : granted > 0 ? Math.min(1, used / granted) : 0;
  config.lastUsageSyncAt = at;
  config.lastUsageStatus = "passed";
  config.lastUsageMessage = usage.unlimitedQuota ? "上游 Key 为无限额度" : "中科云额度已同步";
  return config;
}

export function publicRetailBalance(config: AiModelConfig) {
  const credit = Math.max(0, Number(config.retailCreditCny || 0));
  const ratio = Math.min(1, Math.max(0, Number(config.upstreamUsageRatio || 0)));
  const used = Number((credit * ratio).toFixed(2));
  return {
    currency: "CNY" as const,
    granted: Number(credit.toFixed(2)),
    used,
    available: Number(Math.max(0, credit - used).toFixed(2)),
    usagePercent: Number((ratio * 100).toFixed(2))
  };
}
