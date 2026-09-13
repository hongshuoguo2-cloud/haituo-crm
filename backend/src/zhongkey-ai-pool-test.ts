import assert from "node:assert/strict";
import type { AiModelConfig } from "./types.js";
import {
  applyZhongkeyUsage,
  fetchZhongkeyModels,
  fetchZhongkeyTokenUsage,
  publicRetailBalance,
  zhongkeyApiRoot
} from "./zhongkey-ai-pool.js";

assert.equal(zhongkeyApiRoot("https://www.zhongkey.com/v1/"), "https://zhongkey.com");
assert.throws(() => zhongkeyApiRoot("https://example.com/v1"), /只允许连接/u);

let usageAuth = "";
const usage = await fetchZhongkeyTokenUsage("sk-test-secret", undefined, async (_url, init) => {
  usageAuth = String((init?.headers as Record<string, string>).authorization || "");
  return new Response(JSON.stringify({
    code: true,
    data: {
      name: "tenant-key",
      total_granted: 5000000,
      total_used: 1000000,
      total_available: 4000000,
      unlimited_quota: false,
      model_limits: { "gpt-5.6-terra": true },
      model_limits_enabled: true,
      expires_at: 0
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
});
assert.equal(usageAuth, "Bearer sk-test-secret");
assert.equal(usage.totalGranted, 5000000);
assert.equal(usage.modelLimits[0], "gpt-5.6-terra");

const config: AiModelConfig = {
  id: "pool_1", provider: "zhongkey", protocol: "openai-compatible", scope: "tenant_pool",
  name: "中科云", baseUrl: "https://zhongkey.com/v1", model: "gpt-5.6-terra", apiKey: "sk-secret",
  enabled: true, temperature: 0.1, useLeadFinder: true, useWebsiteParse: true, useScoring: true,
  useEmailDraft: true, useExam: true, upstreamLimitCny: 10, retailCreditCny: 100,
  ownerId: "platform", teamId: "tenant-a", updatedAt: "2026-09-13T00:00:00.000Z"
};
applyZhongkeyUsage(config, usage, "2026-09-13T01:00:00.000Z");
assert.deepEqual(publicRetailBalance(config), {
  currency: "CNY", granted: 100, used: 20, available: 80, usagePercent: 20
});
assert.equal(config.lastUsageStatus, "passed");

const models = await fetchZhongkeyModels(async () => new Response(JSON.stringify({ data: [
  { model_name: "gpt-5.6-terra", description: "test", supported_endpoint_types: ["openai"], enable_groups: ["GPT"] },
  { model_name: "gpt-5.6-terra", supported_endpoint_types: ["openai"] },
  { model_name: "claude-sonnet-5", supported_endpoint_types: ["anthropic", "openai"] }
] }), { status: 200, headers: { "content-type": "application/json" } }));
assert.deepEqual(models.map((item) => item.id), ["claude-sonnet-5", "gpt-5.6-terra"]);

await assert.rejects(
  () => fetchZhongkeyTokenUsage("sk-invalid", undefined, async () => new Response(JSON.stringify({ message: "invalid token" }), { status: 401 })),
  /Key 无效/u
);

const exposed = "sk-this-must-never-leak";
await assert.rejects(
  () => fetchZhongkeyTokenUsage("sk-invalid", undefined, async () => new Response(JSON.stringify({ message: `upstream rejected ${exposed}` }), { status: 400 })),
  (error: unknown) => error instanceof Error && !error.message.includes(exposed) && error.message.includes("密钥已隐藏")
);

console.log("zhongkey ai pool tests passed");
