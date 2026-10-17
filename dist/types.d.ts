/** Lane names the viewer knows how to order and label. Any other string
 *  still works; it just gets its own lane at the end. */
export declare const SERVICES: readonly ["buyer", "agent", "touch_layer", "merchant_web", "merchant_api", "payment_api", "stripe"];
export type KnownService = (typeof SERVICES)[number];
export interface HttpView {
    headers?: Record<string, string>;
    body?: unknown;
}
/** One end's account of an HTTP exchange. The caller and the server each
 *  report the same exchange (same traceId + spanId); the collector keeps both. */
export interface SideView {
    reporter: string;
    from?: string;
    to?: string;
    status?: number;
    durationMs?: number;
    request?: HttpView;
    response?: HttpView;
    error?: string;
}
export interface TraceEvent {
    kind: "exchange" | "note";
    /** Notes only: unique id, since a span can carry several notes. */
    eventId?: string;
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    side?: "caller" | "server";
    view?: SideView;
    /** Notes only: the service having the thought. */
    service?: string;
    method?: string;
    url?: string;
    path?: string;
    startedAt: string;
    label?: string;
    detail?: string;
    payload?: unknown;
    checkoutId?: string;
    orderId?: string;
    /** Extra keys that join traces into one transaction, e.g. "cart_item:abc".
     *  Anything sharing a key (or a checkout id) lands in the same transaction. */
    links?: string[];
}
