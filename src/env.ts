/** Prefix for every environment setting this server reads. */
export const ENV_PREFIX = "CARTOGRAPHER_";

/** Prefix used before the project was renamed from WebMCP-Selenium. */
const LEGACY_ENV_PREFIX = "WEBMCP_";

/**
 * Read a CARTOGRAPHER_* setting. When it is unset, the matching WEBMCP_*
 * name is read instead, so configurations written before the rename still
 * work.
 */
export function envSetting(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name];
  if (value !== undefined || !name.startsWith(ENV_PREFIX)) return value;
  return env[LEGACY_ENV_PREFIX + name.slice(ENV_PREFIX.length)];
}
