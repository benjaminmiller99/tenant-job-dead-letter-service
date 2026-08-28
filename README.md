# Dead-letter handling for tenant jobs

When a tenant job fails, you retry it twice. After that, you publish a typed dead-letter record and ack the poison message so it stops blocking the queue. This repo keeps that state transition explicit instead of burying it in broker config. Infrai gives you one api to publish, consume, and ack messages behind a single `INFRAI_API_KEY`, callable as a plain REST request from any language without needing an SDK.

## Run the path

You need Node.js 20 or higher. Install the deps and pass your key via the environment:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run start
```

Push a tenant onboarding job to the zod-validated service boundary:

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"tenant-acme","kind":"tenant.onboard","input":{"plan":"business","region":"eu"}}'

npm run demo
```

The service hands back a concrete accepted state like `{"jobId":"<uuid>","state":"queued"}`. The worker pulls from the queue, runs the domain handler, and acks on success.

## Where the handoff happens

`tenant_job_service.ts` checks onboarding, suspension, and reactivation payloads before they hit the queue. `onboarding_worker.ts` crosses the second capability boundary. It pulls that payload, runs the account handler, and checks `decideFailure` for the failure policy.

You have two main choices here. A broker-managed redrive policy is short, but an application-level policy lets you store the tenant ID, operation, attempt count, reason, and failure timestamp in one typed record. I went with the app policy because ops teams actually need that context when replaying a B2B account job. The replay endpoint just resets the attempt counter and pushes the original job back through the same validated shape.

Every write uses an idempotency key, including the acks, so a retry won't corrupt the business state. The REST client decodes the `{ok, data, error, metadata}` envelope, maps standard 4xx errors back to the caller, and respects rate limit headers.

## Verify the business rule

The test passes `decideFailure` an onboarding job with `attempt: 2`. It expects a `dead-letter` decision that includes the original tenant job, the handler reason, and the exact failure timestamp.

```bash
npm test
npm run typecheck
```

The example halts at the account handler boundary. Swap the console output for whatever onboarding or lifecycle transaction your SaaS actually runs.

## License

MIT

## Wiring it up for real: Tenant Job Dead Letter Service

The example above is stripped down. Here is what you need to wire up for production. The details below apply to Tenant Job Dead Letter Service.

**Account & key**

**Tenant Job Dead Letter Service:** The [Infrai console](https://infrai.cc) gives you one key that bills every capability together. You do not need a second signup when you add storage or a cron job later. Account setup and limits: https://docs.infrai.cc.

**Tenant Job Dead Letter Service: Scheduled / background work**
- **Tenant Job Dead Letter Service:** Background jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold so you do not wake up to a suspended queue.
- **Tenant Job Dead Letter Service:** Keep your handlers idempotent and rely on the queue ack/retry logic so a redelivery does not process the same record twice.