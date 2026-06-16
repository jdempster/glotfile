import { describe, it, expect } from "vitest";
import { explainProviderError } from "./explain-error.js";

describe("explainProviderError", () => {
  it("turns the AWS credential-chain error into actionable AWS_PROFILE/.env guidance", () => {
    const msg = explainProviderError("bedrock", new Error("Could not load credentials from any providers"));
    expect(msg).toMatch(/credentials/i);
    expect(msg).toMatch(/AWS_PROFILE/);
    expect(msg).toMatch(/\.env|restart/i);
  });

  it("explains the on-demand inference-profile requirement and the region prefix", () => {
    const raw = "ValidationException: Invocation of model ID anthropic.claude-3-5-sonnet-20241022-v2:0 with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.";
    const msg = explainProviderError("bedrock", new Error(raw));
    expect(msg).toMatch(/inference profile/i);
    expect(msg).toMatch(/us\.|eu\.|apac\./);
  });

  it("explains a model-access-not-enabled error for Bedrock (Bedrock console)", () => {
    const msg = explainProviderError("bedrock", new Error("AccessDeniedException: You don't have access to the model with the specified model ID."));
    expect(msg).toMatch(/model access|enable|Bedrock console/i);
  });

  it("explains an IAM-not-authorized error for Bedrock by naming the missing action", () => {
    const raw = "AccessDeniedException: User: arn:aws:iam::384724733943:user/jamesd-translate is not authorized to perform: bedrock:InvokeModel on resource: ... because no identity-based policy allows the bedrock:InvokeModel action";
    const msg = explainProviderError("bedrock", new Error(raw));
    expect(msg).toMatch(/IAM|permission|policy/i);
    expect(msg).toMatch(/bedrock:InvokeModel/);
  });

  it("explains a missing region for Bedrock", () => {
    const msg = explainProviderError("bedrock", new Error("AWS region is not set. Set the Region in your local AI settings or AWS_REGION."));
    expect(msg).toMatch(/region/i);
  });

  it("explains a missing OpenAI API key", () => {
    const msg = explainProviderError("openai", new Error("401 Incorrect API key provided"));
    expect(msg).toMatch(/OPENAI_API_KEY/);
  });

  it("falls back to the raw message for an unrecognised error so no detail is lost", () => {
    const msg = explainProviderError("bedrock", new Error("Some totally novel failure 12345"));
    expect(msg).toContain("Some totally novel failure 12345");
  });

  it("accepts a plain string or unknown value without throwing", () => {
    expect(explainProviderError("ollama", "boom")).toContain("boom");
    expect(typeof explainProviderError("anthropic", undefined)).toBe("string");
  });
});
