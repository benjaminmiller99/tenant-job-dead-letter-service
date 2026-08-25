import { describe, expect, it, vi } from "vitest";
import { InfraiQueue } from "../src/infrai_queue.js";

const response = (data: unknown = {}) =>
  new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("InfraiQueue request contract", () => {
  it("includes the queue in publish, consume, and ack bodies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ messages: [] }))
      .mockResolvedValueOnce(response());
    const queue = new InfraiQueue("test-key", fetcher);

    await queue.publish({ job: "one" }, "publish-key");
    await queue.consume(10, 30);
    await queue.ack("message-one", "ack-key");

    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { queue: "tenant-jobs", payload: { job: "one" } },
      { queue: "tenant-jobs", max_messages: 10, visibility_timeout: 30 },
      { queue: "tenant-jobs", message_id: "message-one" },
    ]);
  });
});
