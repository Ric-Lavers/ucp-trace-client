// createTracer() gives one app everything it needs to report to ucp-trace:
//
//   const tracer = createTracer({ service: "merchant_api" });
//   tracer.instrumentFastify(app);          // inbound requests (Fastify)
//   export const POST = tracer.route(fn);   // inbound requests (Next.js route handler)
//   await tracer.fetch(url, init);          // outbound requests (also pass to Stripe, see README)
//   tracer.note("Verified signature");      // an internal step worth showing
//   tracer.tag({ checkoutId });             // link this span to a UCP checkout
//
// Spans travel between apps in the standard W3C `traceparent` header. With no
// TRACE_URL set, every method is a cheap pass-through.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { parseBody, redactBody, redactHeaders } from "./redact.js";
export * from "./types.js";
export { mask, parseBody, redactBody, redactHeaders } from "./redact.js";
const CHECKOUT_PATH = /\/checkout-sessions\/([^/?#]+)/;
const ORDER_PATH = /\/orders\/([^/?#]+)/;
const MAX_CAPTURE = 256_000;
const hex = (bytes) => randomBytes(bytes).toString("hex");
export function parseTraceparent(header) {
    const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(header?.trim() ?? "");
    return m ? { traceId: m[1], spanId: m[2] } : undefined;
}
/** Find UCP ids in a path or a response body, so traces that the browser
 *  hand-over splits apart can be stitched back together by checkout id. */
function findIds(path, body) {
    const ids = {};
    const c = path && CHECKOUT_PATH.exec(path);
    if (c)
        ids.checkoutId = decodeURIComponent(c[1]);
    const o = path && ORDER_PATH.exec(path);
    if (o)
        ids.orderId = decodeURIComponent(o[1]);
    if (body && typeof body === "object" && !Array.isArray(body)) {
        const b = body;
        // A UCP checkout object: has an id, a status and line items.
        if (!ids.checkoutId && typeof b.id === "string" && "line_items" in b && "status" in b)
            ids.checkoutId = b.id;
        const order = b.order;
        if (!ids.orderId && order && typeof order.id === "string")
            ids.orderId = order.id;
    }
    return ids;
}
async function readCapped(r) {
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("event-stream") || ct.startsWith("image/") || ct.startsWith("audio/") || ct.startsWith("video/")) {
        return undefined; // streams would never finish; media isn't worth showing
    }
    try {
        const text = await r.clone().text();
        return text.length > MAX_CAPTURE ? text.slice(0, MAX_CAPTURE) : text;
    }
    catch {
        return undefined;
    }
}
export function createTracer(opts) {
    const url = (opts.url ?? process.env.TRACE_URL)?.replace(/\/$/, "");
    const key = opts.key ?? process.env.TRACE_KEY ?? "";
    const enabled = Boolean(url);
    const targets = { "api.stripe.com": "stripe", ...opts.targets };
    const als = new AsyncLocalStorage();
    const pending = new Set();
    const rawFetch = globalThis.fetch.bind(globalThis);
    function send(events) {
        if (!enabled)
            return Promise.resolve();
        const p = rawFetch(`${url}/ingest`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-trace-key": key },
            body: JSON.stringify(events),
            keepalive: true,
        })
            .then(() => undefined)
            .catch(() => undefined) // tracing must never break the app
            .finally(() => pending.delete(p));
        pending.add(p);
        return p;
    }
    function laneFor(target) {
        return targets[target.host] ?? targets[target.hostname] ?? target.hostname;
    }
    /** Inbound: build the span from the caller's traceparent (or start a trace). */
    function inbound(headers) {
        const get = (name) => headers instanceof Headers ? headers.get(name) : headers[name];
        const parent = parseTraceparent(get("traceparent"));
        const from = get("x-trace-from") ?? opts.defaultCaller ?? "unknown";
        // An instrumented caller made this span already; we share it. Otherwise it's ours.
        const ctx = parent
            ? { traceId: parent.traceId, spanId: parent.spanId, tags: {} }
            : { traceId: hex(16), spanId: hex(8), tags: {} };
        return { ctx, from: String(from) };
    }
    function exchangeEvent(ctx, side, base, view) {
        const path = (() => {
            try {
                const u = new URL(base.url, "http://local");
                return u.pathname + u.search;
            }
            catch {
                return base.url;
            }
        })();
        const ids = { ...findIds(path, view.response?.body), ...ctx.tags };
        return {
            kind: "exchange",
            traceId: ctx.traceId,
            spanId: ctx.spanId,
            parentSpanId: base.parentSpanId,
            side,
            view,
            method: base.method,
            url: base.url,
            path,
            startedAt: base.startedAt.toISOString(),
            label: base.label,
            ...ids,
        };
    }
    // ---- outbound ---------------------------------------------------------
    async function tracedFetch(input, init, meta) {
        if (!enabled)
            return rawFetch(input, init);
        const parent = als.getStore();
        const ctx = { traceId: parent?.traceId ?? hex(16), spanId: hex(8), tags: {} };
        const req = new Request(input, init);
        req.headers.set("traceparent", `00-${ctx.traceId}-${ctx.spanId}-01`);
        req.headers.set("x-trace-from", opts.service);
        const target = new URL(req.url);
        const startedAt = new Date();
        const reqText = await readCapped(req);
        const view = {
            reporter: opts.service,
            from: opts.service,
            to: meta?.to ?? laneFor(target),
            request: { headers: redactHeaders(req.headers), body: redactBody(parseBody(reqText, req.headers.get("content-type"))) },
        };
        const base = { method: req.method, url: req.url, startedAt, parentSpanId: parent?.spanId, label: meta?.label };
        try {
            const res = await rawFetch(req);
            const resText = await readCapped(res);
            view.status = res.status;
            view.durationMs = Date.now() - startedAt.getTime();
            view.response = { headers: redactHeaders(res.headers), body: redactBody(parseBody(resText, res.headers.get("content-type"))) };
            void send([exchangeEvent(ctx, "caller", base, view)]);
            return res;
        }
        catch (err) {
            view.durationMs = Date.now() - startedAt.getTime();
            view.error = err.message;
            void send([exchangeEvent(ctx, "caller", base, view)]);
            throw err;
        }
    }
    // ---- inbound: Fastify ---------------------------------------------------
    /** Call before registering routes. Wraps every route handler so outbound
     *  calls made while handling a request become its children. */
    function instrumentFastify(app) {
        if (!enabled)
            return;
        const STATE = Symbol("ucpTrace");
        app.addHook("onRoute", (route) => {
            const handler = route.handler;
            route.handler = function (req, reply) {
                const st = req[STATE];
                return st ? als.run(st.ctx, () => handler.call(this, req, reply)) : handler.call(this, req, reply);
            };
        });
        app.addHook("onRequest", async (req) => {
            const { ctx, from } = inbound(req.headers);
            req[STATE] = { ctx, from, startedAt: new Date() };
        });
        app.addHook("onSend", async (req, reply, payload) => {
            const st = req[STATE];
            if (st && typeof payload === "string")
                st.resBody = parseBody(payload, reply.getHeader("content-type"));
            return payload;
        });
        app.addHook("onResponse", async (req, reply) => {
            const st = req[STATE];
            if (!st)
                return;
            void send([
                exchangeEvent(st.ctx, "server", { method: req.method, url: req.url, startedAt: st.startedAt }, {
                    reporter: opts.service,
                    from: st.from,
                    to: opts.service,
                    status: reply.statusCode,
                    durationMs: Date.now() - st.startedAt.getTime(),
                    request: { headers: redactHeaders(req.headers), body: redactBody(req.body) },
                    response: { headers: redactHeaders(reply.getHeaders()), body: redactBody(st.resBody) },
                }),
            ]);
        });
    }
    // ---- inbound: Next.js route handlers --------------------------------------
    /** Wrap a Next.js route handler (Node runtime). On Vercel, pass `after`
     *  from "next/server" so the report is sent after the response. */
    function route(handler, hooks) {
        return async (req, ...rest) => {
            if (!enabled)
                return handler(req, ...rest);
            const { ctx, from } = inbound(req.headers);
            const startedAt = new Date();
            const reqText = await readCapped(req);
            const res = await als.run(ctx, () => handler(req, ...rest));
            const resText = await readCapped(res);
            const p = send([
                exchangeEvent(ctx, "server", { method: req.method, url: req.url, startedAt }, {
                    reporter: opts.service,
                    from,
                    to: opts.service,
                    status: res.status,
                    durationMs: Date.now() - startedAt.getTime(),
                    request: { headers: redactHeaders(req.headers), body: redactBody(parseBody(reqText, req.headers.get("content-type"))) },
                    response: { headers: redactHeaders(res.headers), body: redactBody(parseBody(resText, res.headers.get("content-type"))) },
                }),
            ]);
            hooks?.after?.(() => p);
            return res;
        };
    }
    // ---- scripts, notes, tags ------------------------------------------------------
    /** Run `fn` as the root of a new trace, e.g. one shopping-agent task. */
    function startTrace(label, fn) {
        const ctx = { traceId: hex(16), spanId: hex(8), tags: {} };
        return als.run(ctx, async () => {
            note(label);
            return fn();
        });
    }
    /** An internal step worth showing, e.g. "Verified request signature". */
    function note(label, detail, payload) {
        const ctx = als.getStore();
        if (!enabled || !ctx)
            return;
        void send([
            {
                kind: "note",
                eventId: randomUUID(),
                traceId: ctx.traceId,
                spanId: ctx.spanId,
                service: opts.service,
                startedAt: new Date().toISOString(),
                label,
                detail,
                payload: redactBody(payload),
                ...ctx.tags,
            },
        ]);
    }
    /** Link the current span to a checkout or order. */
    function tag(ids) {
        const ctx = als.getStore();
        if (ctx)
            Object.assign(ctx.tags, ids);
    }
    /** Wait for reports in flight, e.g. before a script or serverless function exits. */
    async function flush() {
        await Promise.allSettled([...pending]);
    }
    return { enabled, service: opts.service, fetch: tracedFetch, instrumentFastify, route, startTrace, note, tag, flush };
}
//# sourceMappingURL=index.js.map