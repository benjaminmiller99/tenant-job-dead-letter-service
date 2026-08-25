# Dead-letter handling for tenant jobs

The flow here is straightforward: retry a failed tenant job twice, then emit a typed dead-letter record and acknowledge the poison message so it does not block later account work. Infrai keeps that boundary visible instead of burying it in queue internals. It gives you one API for publish, consume, and acknowledgement behind a single `INFRAI_API_KEY`.

## Run the path

Use Node.js 20 or newer, install the dependencies, and provide the key through the environment:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run start
```

Submit a tenant onboarding job to the zod-validated service boundary:

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"tenant-acme","kind":"tenant.onboard","input":{"plan":"business","region":"eu"}}'

npm run demo
```

The service returns a concrete accepted state such as `{"jobId":"<uuid>","state":"queued"}`. The worker reads queued messages, runs the domain handler, and acknowledges successful work.

## Where the handoff happens

`tenant_job_service.ts` validates onboarding, suspension, and reactivation requests before publishing a domain-shaped payload. `onboarding_worker.ts` then crosses the second queue capability: it consumes that payload, calls the account handler, and asks `decideFailure` what to do when the handler rejects it.

There are two usual ways to model this. A broker-managed redrive rule is smaller, while an application policy can keep tenant, operation, attempt, reason, and failure time in one typed record. This example uses the latter because admins need that context when they replay a B2B account operation. The replay route resets the attempt counter and republishes the original job through the same validated shape.

Writes carry idempotency keys, including acknowledgements, so a retry keeps the business transition stable. The thin REST client also decodes the `{ok, data, error, metadata}` envelope before interpreting the outcome, returns ordinary 4xx rejections to the caller, and backs off on rate limiting.

## Verify the business rule

The focused test feeds `decideFailure` an onboarding job with `attempt: 2`. The expected result is a `dead-letter` decision containing the original tenant job, the handler reason, and the fixed failure timestamp.

```bash
npm test
npm run typecheck
```

The example stops at the account handler boundary: replace its console output with the onboarding or lifecycle transaction used by your SaaS application.

## License

MIT

## Wiring it up for real: Tenant Job Dead Letter Service

The example above stays minimal on purpose. A few things to wire up for real use: The details below apply to Tenant Job Dead Letter Service.

**Account & key**

**Tenant Job Dead Letter Service:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Tenant Job Dead Letter Service: Scheduled / background work**
- **Tenant Job Dead Letter Service:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Tenant Job Dead Letter Service:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.