const REDACTED = '[REDACTED]';

const SECRET_FIELD_PATTERN =
  /^(api[-_ ]?key|apikey|authorization|cookie|set-cookie|token|access[-_ ]?token|refresh[-_ ]?token|company[-_ ]?key|client[-_ ]?secret|secret|password|credential|oauth)$/i;

const SECRET_TEXT_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bsk-[A-Za-z0-9._-]{8,}/g,
  /\buclaw[_-]company[_-][A-Za-z0-9._-]{8,}/gi,
  /\b(api[-_ ]?key|company[-_ ]?key|token|authorization)\s*[:=]\s*["']?[^"'\s,;]+/gi,
  /\bcookie\s*:\s*[^\n\r]+/gi,
];

export function redactDiagnosticsText(input: string): string {
  return SECRET_TEXT_PATTERNS.reduce((text, pattern) => {
    return text.replace(pattern, (match) => {
      const separator = match.includes('=') ? '=' : match.includes(':') ? ':' : ' ';
      const prefix = match.split(separator)[0]?.trimEnd() ?? '';
      return prefix ? `${prefix}${separator} ${REDACTED}` : REDACTED;
    });
  }, input);
}

export function redactDiagnosticsValue<T>(value: T): T {
  if (typeof value === 'string') {
    return redactDiagnosticsText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticsValue(item)) as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SECRET_FIELD_PATTERN.test(key) ? REDACTED : redactDiagnosticsValue(child);
    }
    return result as T;
  }
  return value;
}
