// Secrets never leave the app: everything is redacted here, before it is
// sent, so the collector can be treated as untrusted storage.

const DROP_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "signature", // RFC 9421 - kept out; signature-input stays so viewers can see *what* was signed
  "stripe-signature",
  "x-api-key",
  "x-trace-key",
]);

// Values that are secrets whatever key they sit under.
const SECRET_VALUE = /^(sk|rk)_(test|live)_|^whsec_|_secret_|^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;
// Values worth showing in part: the reader should see that a token was passed, not the token.
const TOKEN_VALUE = /^(spt|pm|tok|card)_[A-Za-z0-9_]+$/;
const SECRET_KEY = /secret|password|passwd|api_?key|private|credential|^token$|access_token|refresh_token|client_secret/i;

const MAX_STRING = 4_000;
const MAX_DEPTH = 12;

export function mask(value: string): string {
  if (value.length <= 8) return "•••";
  return `${value.slice(0, value.indexOf("_") + 1 || 3)}•••${value.slice(-4)}`;
}

export function redactHeaders(headers: Headers | Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const entries: [string, unknown][] =
    headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers);
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.toLowerCase();
    if (rawValue == null) continue;
    if (DROP_HEADERS.has(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
  }
  return out;
}

export function redactBody(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[too deep]";
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) return "[redacted]";
    if (TOKEN_VALUE.test(value)) return mask(value);
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… [${value.length} chars]` : value;
  }
  if (Array.isArray(value)) return value.map((v) => redactBody(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) && v != null && v !== "") {
        out[k] = typeof v === "string" && TOKEN_VALUE.test(v) ? mask(v) : "[redacted]";
      } else {
        out[k] = redactBody(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/** Turn a raw body (JSON, form-encoded, or text) into something displayable. */
export function parseBody(raw: unknown, contentType?: string | null): unknown {
  if (raw == null || raw === "") return undefined;
  if (typeof raw !== "string") {
    if (raw instanceof URLSearchParams) return Object.fromEntries(raw);
    if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) return `[${(raw as ArrayBuffer).byteLength} bytes binary]`;
    return raw;
  }
  const ct = contentType ?? "";
  if (ct.includes("json") || /^\s*[[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through */
    }
  }
  if (ct.includes("x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  return raw;
}
