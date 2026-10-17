export * from "./types.js";
export { mask, parseBody, redactBody, redactHeaders } from "./redact.js";
export interface TracerOptions {
    /** This app's lane, e.g. "merchant_api". */
    service: string;
    /** Collector base URL. Defaults to env TRACE_URL; unset disables tracing. */
    url?: string;
    /** Ingest key. Defaults to env TRACE_KEY. */
    key?: string;
    /** Hostname → lane, for outbound calls whose server isn't instrumented
     *  (Stripe, the UCP reference store). Stripe is mapped by default. */
    targets?: Record<string, string>;
    /** Who is calling when an inbound request has no `x-trace-from` header.
     *  "buyer" suits pages a browser loads. Default "unknown". */
    defaultCaller?: string;
    /** Work out the caller from an inbound request's headers, for callers that
     *  can't send `x-trace-from` (e.g. `stripe-signature` → "stripe"). */
    callerOf?: (header: (name: string) => string | undefined) => string | undefined;
}
type Tags = {
    checkoutId?: string;
    orderId?: string;
    links?: string[];
};
export declare function parseTraceparent(header: string | null | undefined): {
    traceId: string;
    spanId: string;
} | undefined;
export type Tracer = ReturnType<typeof createTracer>;
export declare function createTracer(opts: TracerOptions): {
    enabled: boolean;
    service: string;
    fetch: (input: string | URL | Request, init?: RequestInit, meta?: {
        to?: string;
        label?: string;
    }) => Promise<Response>;
    instrumentFastify: (app: FastifyLike) => void;
    route: <A extends unknown[]>(handler: (req: Request, ...rest: A) => Response | Promise<Response>, hooks?: {
        after?: (fn: () => Promise<unknown>) => void;
    }) => (req: Request, ...rest: A) => Promise<Response>;
    startTrace: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
    note: (label: string, detail?: string, payload?: unknown) => void;
    tag: (ids: Tags) => void;
    flush: () => Promise<void>;
};
/** The slice of Fastify's API we use, so the client doesn't depend on Fastify. */
export interface FastifyLike {
    addHook(name: string, fn: (...args: any[]) => unknown): unknown;
}
