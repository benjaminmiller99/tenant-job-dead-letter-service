import { z } from "zod";

export const SaaSJobSchema = z.object({
  jobId: z.string().uuid(),
  tenantId: z.string().min(1),
  kind: z.enum(["tenant.onboard", "account.suspend", "account.reactivate"]),
  attempt: z.number().int().nonnegative(),
  input: z.record(z.string()),
});

export type SaaSJob = z.infer<typeof SaaSJobSchema>;

export type DeadLetter = {
  type: "dead-letter";
  failedJob: SaaSJob;
  reason: string;
  failedAt: string;
};

export type FailureDecision =
  | { action: "retry"; nextJob: SaaSJob }
  | { action: "dead-letter"; record: DeadLetter };

export function decideFailure(job: SaaSJob, reason: string, now: Date): FailureDecision {
  if (job.attempt < 2) {
    return { action: "retry", nextJob: { ...job, attempt: job.attempt + 1 } };
  }
  return {
    action: "dead-letter",
    record: { type: "dead-letter", failedJob: job, reason, failedAt: now.toISOString() },
  };
}
