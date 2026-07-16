export type FabricServerConfig = Readonly<{
  development: boolean;
  hostname: string;
  port: number;
}>;

const DEFAULT_PORT = 3_000;
const DEFAULT_HOSTNAME = "0.0.0.0";
const HOSTNAME_PATTERN = /^(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\]|[A-Fa-f0-9:]+)$/;

export function loadFabricServerConfig(
  environment: Record<string, string | undefined> = process.env,
): FabricServerConfig {
  const nodeEnvironment = environment.NODE_ENV;
  if (nodeEnvironment !== "development" && nodeEnvironment !== "production") {
    throw new Error("NODE_ENV must be development or production before Fabric starts.");
  }

  const rawPort = environment.PORT?.trim() || String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const hostname = environment.FABRIC_HOST?.trim() || DEFAULT_HOSTNAME;
  if (hostname.length > 255 || !HOSTNAME_PATTERN.test(hostname)) {
    throw new Error("FABRIC_HOST must be a valid hostname or IP address.");
  }

  return Object.freeze({
    development: nodeEnvironment === "development",
    hostname,
    port,
  });
}
