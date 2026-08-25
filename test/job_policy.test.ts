import { describe, expect, it } from "vitest";
import { decideFailure, type SaaSJob } from "../src/job_policy.js";

const job: SaaSJob = {
  jobId: "d260c9d0-a7e8-4bb9-9ae2-70e781bda8af",
  tenantId: "tenant-acme",
  kind: "tenant.onboard",
  attempt: 2,
  input: { plan: "business", region: "eu" },
};

describe("dead-letter policy", () => {
  it("isolates a poison onboarding job after its third failed delivery", () => {
    const result = decideFailure(job, "CRM validation rejected the account", new Date("2026-08-19T08:00:00Z"));
    expect(result).toEqual({
      action: "dead-letter",
      record: {
        type: "dead-letter",
        failedJob: job,
        reason: "CRM validation rejected the account",
        failedAt: "2026-08-19T08:00:00.000Z",
      },
    });
  });
});
