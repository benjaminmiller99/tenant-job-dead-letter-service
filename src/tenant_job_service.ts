import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { InfraiError, InfraiQueue } from "./infrai_queue.js";
import { SaaSJobSchema } from "./job_policy.js";

const SubmitSchema = SaaSJobSchema.omit({ jobId: true, attempt: true });
const ReplaySchema = z.object({ deadLetter: z.object({ failedJob: SaaSJobSchema }) });

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const queue = new InfraiQueue();
const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/jobs") {
      const input = SubmitSchema.parse(await readJson(request));
      const job = { ...input, jobId: randomUUID(), attempt: 0 };
      await queue.publish(job, `submit:${job.jobId}`);
      return json(response, 202, { jobId: job.jobId, state: "queued" });
    }
    if (request.method === "POST" && request.url === "/admin/dead-letters/replay") {
      const { deadLetter } = ReplaySchema.parse(await readJson(request));
      const replay = { ...deadLetter.failedJob, attempt: 0 };
      await queue.publish(replay, `replay:${replay.jobId}`);
      return json(response, 202, { jobId: replay.jobId, state: "queued" });
    }
    return json(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) return json(response, 400, { error: error.flatten() });
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      return json(response, error.status, { error: error.code, detail: error.detail });
    }
    console.error(error);
    return json(response, 500, { error: "Request could not be completed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Tenant job service listening on http://localhost:${port}`));
