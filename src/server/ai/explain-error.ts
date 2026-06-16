// Turns a raw provider/SDK error into an actionable, provider-aware message.
// Used wherever a translation provider error reaches the user (the translate
// endpoints and the AI connection test), so a cryptic SDK string like
// "Could not load credentials from any providers" becomes a next step.
//
// Always falls back to the raw message, so no diagnostic detail is ever lost.

const KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function rawMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err ?? "Unknown error");
}

export function explainProviderError(provider: string, err: unknown): string {
  const raw = rawMessage(err);
  const m = raw.toLowerCase();

  if (provider === "bedrock") {
    // No usable credentials resolved from the whole AWS chain.
    if (/could not load credentials|unable to locate credentials|credentialsprovider|credentials from any providers/.test(m)) {
      return "No AWS credentials found. Set AWS_PROFILE (or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) in your shell or a .env file in the directory you started glotfile from, or use an SSO / instance role. If you just edited .env, restart glotfile so it reloads. For SSO, run `aws sso login`.";
    }
    // Newer Claude/Nova models reject bare model IDs for on-demand use.
    if (/on-demand throughput isn.?t supported/.test(m) || /inference profile/.test(m)) {
      return 'This Bedrock model needs an inference profile for on-demand use. Prefix the model id with your region group — e.g. "eu.anthropic.claude-3-5-sonnet-20241022-v2:0" (or "us." / "apac." for your region).';
    }
    // Credentials are valid, but the IAM policy lacks the Bedrock action.
    if (/not authorized to perform/.test(m) || /no identity-based policy/.test(m) || /bedrock:invoke/.test(m)) {
      return "Your AWS credentials authenticated, but their IAM policy doesn't allow this action. Add bedrock:InvokeModel (and bedrock:InvokeModelWithResponseStream) for this model to the IAM policy on this user/role.";
    }
    // Authenticated, but the account/region hasn't enabled this model.
    if (/access to the model|don.?t have access to the model/.test(m)) {
      return "Your account doesn't have access to this model in this region. Enable it in the Bedrock console under Model access, for the region you configured.";
    }
    // Any other access-denied: could be either of the two above.
    if (/access ?denied/.test(m)) {
      return "Bedrock denied access. Either the model isn't enabled for your account/region (enable it in the Bedrock console under Model access) or your IAM policy is missing bedrock:InvokeModel for this model.";
    }
    if (/region/.test(m)) {
      return "No AWS region set for Bedrock. Set the Region in AI settings, or AWS_REGION in your environment.";
    }
  }

  // Auth failures for key-based providers — point at the right env var.
  const keyEnv = KEY_ENV[provider];
  if (keyEnv && /api key|unauthorized|\b401\b|authentication|incorrect api key|invalid x-api-key/.test(m)) {
    return `${provider} rejected the request — check ${keyEnv}. Set it in your environment or a .env file in the directory you started glotfile from.`;
  }

  return raw;
}
