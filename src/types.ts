// The one event shape every app sends to the collector. Shared with the
// collector and viewer, so keep it plain data.

/** Lane names the viewer knows how to order and label. Any other string
 *  still works; it just gets its own lane at the end. */
export const SERVICES = [
  "buyer",
  "agent",
  "touch_layer",
  "merchant_web",
  "merchant_api",
  "payment_api",
  "stripe",
] as const;
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
  traceId: string; // 32 hex chars (W3C trace-context)
  spanId: string; // 16 hex chars
  parentSpanId?: string;
  side?: "caller" | "server"; // exchanges only
  view?: SideView; // exchanges only
  /** Notes only: the service having the thought. */
  service?: string;
  method?: string;
  url?: string;
  path?: string;
  startedAt: string; // ISO
  label?: string;
  detail?: string;
  payload?: unknown; // notes only
  checkoutId?: string;
  orderId?: string;
}
