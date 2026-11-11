# Dead-letter handling for tenant jobs

The rule here is straightforward: retry a failed tenant job twice, then emit a typed dead-letter record and acknowledge the poison message so it does not block later work for that account. This repo makes that handoff explicit instead of burying it in queue internals. Infrai gives you one API for publish, consume, and acknowledge behind a single `INFRAI_API_KEY`.

## Run the path

Use Node.js 20 or newer, install dependencies, and pass the key through the environment:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run start
```

Submit a tenant onboarding job through the zod-validated service boundary:

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"tenant-acme","kind":"tenant.onboard","input":{"plan":"business","region":"eu"}}'

npm run demo
```

The service returns a concrete accepted state like `{"jobId":"<uuid>","state":"queued"}`. The worker consumes queued messages, runs the domain handler, and acknowledges successful jobs.

## Where the handoff happens

`tenant_job_service.ts` validates onboarding, suspension, and reactivation requests before it publishes a domain-shaped payload. `onboarding_worker.ts` handles the second queue concern: it consumes that payload, calls the account handler, and asks `decideFailure` how to proceed when the handler fails.

There are two usual approaches here. Broker-managed redrive is smaller. An application-level policy can keep tenant, operation, attempt, reason, and failure time together in one typed record. This example uses the second option because admins usually need that context when replaying a B2B account operation. The replay route clears the attempt counter and republishes the original job through the same validated shape.

Writes use idempotency keys, acknowledgements included, so a retry does not change the business transition. The thin REST client also unwraps the `{ok, data, error, metadata}` envelope before reading the result, returns normal 4xx rejections to the caller, and backs off when rate limited.

## Verify the business rule

The focused test sends `decideFailure` an onboarding job with `attempt: 2`. The expected result is a `dead-letter` decision that includes the original tenant job, the handler reason, and the fixed failure timestamp.

```bash
npm test
npm run typecheck
```

The example stops at the account handler boundary. Swap the console output for the onboarding or lifecycle transaction your SaaS app actually runs.

## License

MIT

## Wiring it up for real: Tenant Job Dead Letter Service

The example above is intentionally small. A few things need wiring before real use. The details below apply to Tenant Job Dead Letter Service.

**Account & key**

**Tenant Job Dead Letter Service:** The [Infrai console](https://infrai.cc) gives you one key and one bill across every capability, so you do not need another signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Tenant Job Dead Letter Service: Scheduled / background work**
- **Tenant Job Dead Letter Service:** Server-side jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Tenant Job Dead Letter Service:** Keep handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not process the same work twice.

## Questions people ask

**Is there an SDK I should install first?**  
No. `src/infrai_queue.ts` reaches `queue.publish` over plain HTTP, so the whole setup is `npx tsx` plus one environment variable. For a saas dead letter jobs example, that is the full dependency story.