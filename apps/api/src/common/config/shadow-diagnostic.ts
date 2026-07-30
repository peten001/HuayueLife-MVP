/**
 * Shadow diagnostic mode is intentionally opt-in. It exists solely for a
 * loopback-only API boot check against production configuration, where no
 * scheduled side effects are permitted.
 */
export function isApiShadowDiagnosticMode(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return environment.API_SHADOW_DIAGNOSTIC_MODE?.trim().toLowerCase() === 'true';
}
