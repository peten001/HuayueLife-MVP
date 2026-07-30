export function resolveListenOptions(environment: NodeJS.ProcessEnv = process.env) {
  const configuredPort = Number(environment.PORT ?? 3001);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
    ? configuredPort
    : 3001;
  const host = environment.HOST?.trim();
  return { port, host: host || undefined };
}
