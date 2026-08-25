import { InfraiQueue, type QueueMessage, type QueuePort } from "./infrai_queue.js";
import { decideFailure, SaaSJobSchema, type SaaSJob } from "./job_policy.js";

export type JobHandler = (job: SaaSJob) => Promise<void>;

export async function processMessage(
  message: QueueMessage,
  queue: QueuePort,
  handle: JobHandler,
  now = new Date(),
): Promise<"completed" | "retried" | "dead-lettered"> {
  const job = SaaSJobSchema.parse(message.payload);
  try {
    await handle(job);
    await queue.ack(message.message_id, `ack:${message.message_id}`);
    return "completed";
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "Job handler rejected the task";
    const decision = decideFailure(job, reason, now);
    const payload = decision.action === "retry" ? decision.nextJob : decision.record;
    await queue.publish(payload, `${decision.action}:${job.jobId}:${job.attempt}`);
    await queue.ack(message.message_id, `ack:${message.message_id}`);
    return decision.action === "retry" ? "retried" : "dead-lettered";
  }
}

async function runOnce(): Promise<void> {
  const queue = new InfraiQueue();
  const messages = await queue.consume(10, 30);
  const results = await Promise.all(
    messages.map((message) =>
      processMessage(message, queue, async (job) => {
        console.log(`Applied ${job.kind} for tenant ${job.tenantId}`);
      }),
    ),
  );
  console.log({ consumed: messages.length, results });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOnce().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
