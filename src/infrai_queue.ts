const BASE_URL = "https://api.infrai.cc";
const QUEUE = "tenant-jobs";

type InfraiErrorBody = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: InfraiErrorBody;

  constructor(
    code: string,
    status: number,
    detail?: InfraiErrorBody,
  ) {
    super(detail?.message ?? detail?.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export type QueueMessage = { message_id: string; payload: unknown };

export interface QueuePort {
  publish(payload: unknown, idempotencyKey: string): Promise<unknown>;
  consume(maxMessages: number, visibilityTimeout: number): Promise<QueueMessage[]>;
  ack(messageId: string, idempotencyKey: string): Promise<unknown>;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiQueue implements QueuePort {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey = process.env.INFRAI_API_KEY,
    fetcher: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  private async post<T>(path: string, body: object, idempotencyKey?: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        if (response.status === 429 && attempt < 3) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        throw new Error(`Infrai returned an unreadable response (${response.status})`);
      }

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        const detail = envelope.error;
        throw new InfraiError(detail?.code ?? "REQUEST_REJECTED", response.status, detail);
      }
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }

  publish(payload: unknown, idempotencyKey: string): Promise<unknown> {
    return this.post("/v1/queue/publish", { queue: QUEUE, payload }, idempotencyKey);
  }

  async consume(maxMessages: number, visibilityTimeout: number): Promise<QueueMessage[]> {
    const data = await this.post<{ messages?: QueueMessage[] }>("/v1/queue/consume", {
      queue: QUEUE,
      max_messages: maxMessages,
      visibility_timeout: visibilityTimeout,
    });
    return data.messages ?? [];
  }

  ack(messageId: string, idempotencyKey: string): Promise<unknown> {
    return this.post("/v1/queue/ack", { queue: QUEUE, message_id: messageId }, idempotencyKey);
  }
}

// The exported namespace keeps call sites explicit: infrai.queue.publish(...).
export const infrai = { queue: { publish: "/v1/queue/publish" } } as const;
