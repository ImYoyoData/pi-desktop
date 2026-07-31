/** Env keys shared between main (worker spawn) and agent-worker (spawn fix). */
export const PI_DESKTOP_NODE_PATH_ENV = "PI_DESKTOP_NODE_PATH";
export const PI_DESKTOP_PI_CLI_PATH_ENV = "PI_DESKTOP_PI_CLI_PATH";
export const PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT_ENV =
  "PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT";
export const PI_SUBAGENT_PI_BINARY_ENV = "PI_SUBAGENT_PI_BINARY";
/**
 * SDK hook: getPackageDir() returns this verbatim when set. The bundled SDK
 * cannot locate its own package root (getPackageDir walks up from the bundle's
 * __dirname to the app root, then picks <root>/src/… — ENOENT for themes and
 * export templates), so main points it at the real package root on the worker.
 */
export const PI_PACKAGE_DIR_ENV = "PI_PACKAGE_DIR";
