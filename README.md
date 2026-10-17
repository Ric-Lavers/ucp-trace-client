# @ucp-trace/client

Tracing for a set of cooperating [Universal Commerce Protocol](https://ucp.dev) apps: a platform (cart), a merchant, a shopping agent and a payment credential provider. Each app reports the HTTP exchanges it takes part in to a ucp-trace collector, which shows every transaction as a sequence diagram.

No runtime dependencies; Node 20+.

## Install

```sh
yarn add @ucp-trace/client@github:Ric-Lavers/ucp-trace-client#v0.1.0
```

The built `dist/` is committed, so installing from git needs no build step.

## Use

Set `TRACE_URL` (the collector) and `TRACE_KEY` (its ingest key). With `TRACE_URL` unset, every call is a pass-through.

```ts
import { createTracer } from "@ucp-trace/client";
export const tracer = createTracer({ service: "merchant_api" });

// Fastify - call before registering routes
tracer.instrumentFastify(app);

// Next.js route handler (Node runtime); `after` sends the report after the response
import { after } from "next/server";
export const POST = tracer.route(async (req) => { /* ... */ }, { after });

// Outbound calls, including Stripe's SDK
await tracer.fetch(`${merchant}/checkout-sessions`, { method: "POST", body });
const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient(tracer.fetch) });

// Internal steps, and linking a span to a UCP checkout
tracer.note("Request signature verified", "RFC 9421");
tracer.tag({ checkoutId });

// Scripts: one root trace per task, then wait for reports to leave
await tracer.startTrace("Buyer asks for X", async () => { /* ... */ });
await tracer.flush();
```

Lane names the viewer knows: `buyer`, `agent`, `touch_layer`, `merchant_web`, `merchant_api`, `payment_api`, `stripe`. Name uninstrumented hosts with `targets`, e.g. `{ "localhost:3000": "merchant_api" }`; for pages a browser loads, set `defaultCaller: "buyer"`.

## How it works

- Spans travel in the W3C `traceparent` header, plus `x-trace-from` naming the calling app. Caller and server report the same exchange under one span id.
- UCP checkout and order ids are picked up from paths (`/checkout-sessions/:id`, `/orders/:id`) and checkout response bodies, so traces split by a browser hand-over can be joined.
- **Secrets are removed before anything is sent** (`src/redact.ts`): `authorization`, cookies, RFC 9421 `signature`, API keys, `client_secret`s and JWTs are dropped, and payment tokens (`spt_`, `pm_`, `tok_`) are masked to their last four characters.
- Reporting is fire-and-forget; a slow or missing collector never fails a request.

## Releasing

```sh
yarn build && git add -A && git commit -m "..." && git tag vX.Y.Z && git push --follow-tags
```
