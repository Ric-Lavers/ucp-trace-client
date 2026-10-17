export declare function mask(value: string): string;
export declare function redactHeaders(headers: Headers | Record<string, unknown> | undefined): Record<string, string>;
export declare function redactBody(value: unknown, depth?: number): unknown;
/** Turn a raw body (JSON, form-encoded, or text) into something displayable. */
export declare function parseBody(raw: unknown, contentType?: string | null): unknown;
