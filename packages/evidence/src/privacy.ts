export type RedactedValue =
  | null
  | boolean
  | number
  | string
  | RedactedValue[]
  | { [key: string]: RedactedValue };

export interface PrivacyGatewayOptions {
  additionalSensitiveKeys?: readonly string[];
  allowlistedSensitiveKeys?: readonly string[];
  redactEmails?: boolean;
}

const sensitiveKeyPattern =
  /(^|[-_])(authorization|cookie|credential|password|private[-_]?key|secret|session[-_]?token|social[-_]?security|ssn|api[-_]?key|access[-_]?token|refresh[-_]?token)($|[-_])/i;
const ssnPattern = /\b[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{4}\b/g;
const apiKeyPattern = /\bsk-[a-zA-Z0-9_-]{16,}\b/g;
const bearerPattern = /\bBearer\s+[a-zA-Z0-9._~-]{12,}\b/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export class PrivacyGateway {
  readonly #additionalSensitiveKeys: Set<string>;
  readonly #allowlistedSensitiveKeys: Set<string>;
  readonly #redactEmails: boolean;

  constructor(options: PrivacyGatewayOptions = {}) {
    this.#additionalSensitiveKeys = new Set(
      (options.additionalSensitiveKeys ?? []).map(normalizeKey),
    );
    this.#allowlistedSensitiveKeys = new Set(
      (options.allowlistedSensitiveKeys ?? []).map(normalizeKey),
    );
    this.#redactEmails = options.redactEmails ?? false;
  }

  sanitize(value: unknown): RedactedValue {
    return this.#sanitize(value, undefined, new WeakSet<object>());
  }

  sanitizeText(value: string): string {
    let sanitized = value
      .replace(ssnPattern, "[REDACTED:SSN]")
      .replace(apiKeyPattern, "[REDACTED:API_KEY]")
      .replace(bearerPattern, "Bearer [REDACTED:TOKEN]");
    if (this.#redactEmails) {
      sanitized = sanitized.replace(emailPattern, "[REDACTED:EMAIL]");
    }
    return sanitized;
  }

  #sanitize(
    value: unknown,
    key: string | undefined,
    ancestors: WeakSet<object>,
  ): RedactedValue {
    if (key !== undefined && this.#isSensitiveKey(key)) {
      return `[REDACTED:${normalizeKey(key).toUpperCase()}]`;
    }
    if (value === null) return null;
    if (typeof value === "string") return this.sanitizeText(value);
    if (typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "undefined") return null;
    if (typeof value === "function" || typeof value === "symbol") {
      return "[REDACTED:UNSERIALIZABLE]";
    }
    if (value instanceof Date) return value.toISOString();
    if (ancestors.has(value)) return "[REDACTED:CIRCULAR]";

    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        return value.map((item) => this.#sanitize(item, undefined, ancestors));
      }

      const result: Record<string, RedactedValue> = {};
      for (const [entryKey, entryValue] of Object.entries(value)) {
        result[entryKey] = this.#sanitize(entryValue, entryKey, ancestors);
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }

  #isSensitiveKey(key: string): boolean {
    const normalized = normalizeKey(key);
    if (this.#allowlistedSensitiveKeys.has(normalized)) return false;
    return (
      this.#additionalSensitiveKeys.has(normalized) ||
      sensitiveKeyPattern.test(normalized)
    );
  }
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, "-").toLowerCase();
}
