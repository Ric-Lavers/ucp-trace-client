# @ucp-trace/client

Tracing for a set of cooperating [Universal Commerce Protocol](https://ucp.dev) apps: a platform (cart), a merchant, a shopping agent and a payment credential provider. Each app reports the HTTP exchanges it takes part in to a ucp-trace collector, which shows every transaction as a sequence diagram.

No runtime dependencies; Node 20+.

## Install

```sh
npm i "@ucp-trace/client@https://github.com/Ric-Lavers/ucp-trace-client/archive/refs/tags/v0.1.2.tar.gz"
```

The built `dist/` is committed, so the release tarball installs with no build step. Prefer the tarball URL to `github:` or `git+https:` specs: npm records those as `git+ssh` in lockfiles, which fails on build machines without an SSH key (e.g. Vercel). The tarball needs no git at all and is pinned by an integrity hash.

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

// Internal steps, and linking a span to a UCP checkout (or any other join key)
tracer.note("Request signature verified", "RFC 9421");
tracer.tag({ checkoutId });
tracer.tag({ links: [`cart_item:${id}`] });

// Scripts: one root trace per task, then wait for reports to leave
await tracer.startTrace("Buyer asks for X", async () => { /* ... */ });
await tracer.flush();
```

Lane names the viewer knows: `buyer`, `agent`, `touch_layer`, `merchant_web`, `merchant_api`, `payment_api`, `stripe`. Name uninstrumented hosts with `targets`, e.g. `{ "localhost:3000": "merchant_api" }`; for pages a browser loads, set `defaultCaller: "buyer"`. Callers that can't send `x-trace-from` can be recognised by a header: `callerOf: (h) => (h("stripe-signature") ? "stripe" : undefined)`.

## How it works

- Spans travel in the W3C `traceparent` header, plus `x-trace-from` naming the calling app. Caller and server report the same exchange under one span id.
- UCP checkout and order ids are picked up from paths (`/checkout-sessions/:id`, `/orders/:id`), checkout bodies and order bodies (`checkout_id`), so traces split by a browser hand-over or a webhook can be joined. `tag({ links })` adds your own join keys, e.g. a cart item that's later checked out.
- Tracing never changes your app's traffic beyond the standard `traceparent` and `x-trace-from` headers: tags are sent to the collector in its own separate reports. CORS preflights (`OPTIONS`) aren't reported.
- **Secrets are removed before anything is sent** (`src/redact.ts`): `authorization`, cookies, RFC 9421 `signature`, API keys, `client_secret`s and JWTs are dropped, and payment tokens (`spt_`, `pm_`, `tok_`) are masked to their last four characters.
- Reporting is fire-and-forget; a slow or missing collector never fails a request.

## Releasing

```sh
yarn build && git add -A && git commit -m "..." && git tag -a vX.Y.Z -m vX.Y.Z && git push --follow-tags
```
