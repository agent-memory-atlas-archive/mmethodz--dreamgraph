/** Lossless values and bounded documents; v0 literal quotes remain readable. */
export const ENGINE_ENV_MAX_BYTES = 1024 * 1024;
export const ENGINE_ENV_MAX_LINE_CHARS = 16 * 1024;
const HEADER = "# dreamgraph.engine_env.v1 — JSON quoted strings";
const KEY = /^[A-Z_][A-Z0-9_]*$/;
export function parseEngineEnvDocument(content: string): Record<string, string> {
  if (Buffer.byteLength(content) > ENGINE_ENV_MAX_BYTES) throw new Error("CONFIG_DOCUMENT_TOO_LARGE");
  const versioned = content.split(/\r?\n/).includes(HEADER);
  const result: Record<string, string> = Object.create(null);
  for (const raw of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (raw.length > ENGINE_ENV_MAX_LINE_CHARS) throw new Error("CONFIG_LINE_TOO_LARGE");
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("="), key = line.slice(0, index).trim();
    if (index < 1 || !KEY.test(key)) throw new Error("CONFIG_INVALID_ASSIGNMENT");
    let value = line.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      if (versioned) {
        try { value = JSON.parse(value); } catch { throw new Error(`CONFIG_INVALID_QUOTING: ${key}`); }
      } else value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    if (typeof value !== "string" || value.includes("\0")) throw new Error(`CONFIG_INVALID_VALUE: ${key}`);
    result[key] = value;
  }
  return result;
}
export function formatEngineEnvAssignment(key: string, value: string): string {
  if (!KEY.test(key) || typeof value !== "string" || value.includes("\0")) throw new Error("CONFIG_INVALID_ASSIGNMENT");
  // Empty is an explicit value: commenting it out could resurrect a deployment secret.
  return `${key}=${/[\s#"'\\]/.test(value) ? JSON.stringify(value) : value}`;
}
export function renderEngineEnvUpdates(content: string, updates: Record<string, string | null>): string {
  const existing = parseEngineEnvDocument(content);
  for (const [key, value] of Object.entries(updates)) {
    if (!KEY.test(key) || (value !== null && typeof value !== "string")) throw new Error("CONFIG_INVALID_ASSIGNMENT");
  }
  const pending = new Set(Object.keys(updates)), emitted = new Set<string>();
  const output = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line !== HEADER).map(line => {
    const match = line.match(/^\s*(#\s*)?([A-Z_][A-Z0-9_]*)\s*=/);
    if (!match) return line;
    const [, commented, key] = match;
    if (!commented || pending.has(key)) {
      if (emitted.has(key)) return `# duplicate ${key} removed`;
      if (commented && !(key in updates)) return line;
      emitted.add(key); pending.delete(key);
      const value = key in updates ? updates[key] : existing[key];
      return value === null ? `# ${key} unset` : formatEngineEnvAssignment(key, value);
    }
    return line;
  });
  for (const key of pending) if (updates[key] !== null) output.push(formatEngineEnvAssignment(key, updates[key]!));
  const next = [HEADER, ...output].join("\n").replace(/\n*$/, "\n");
  parseEngineEnvDocument(next);
  return next;
}
