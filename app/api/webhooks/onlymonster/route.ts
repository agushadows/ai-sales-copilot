import { createHmac, timingSafeEqual } from "node:crypto";
import { addWebhookEvent } from "./store";

export const runtime = "nodejs";

const handledEvents = new Set([
  "chat.message",
  "chat.message_sent",
  "chat.message_error",
  "fans.subscription.new_subscriber",
  "fans.ppv.purchased",
  "fans.tip.received",
]);

type WebhookBody = {
  type?: string;
  payload?: unknown;
};

function readPath(value: unknown, path: string[]) {
  let current = value;

  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function readString(value: unknown, path: string[]) {
  const result = readPath(value, path);

  if (typeof result === "string") {
    return result;
  }

  if (typeof result === "number") {
    return String(result);
  }

  return null;
}

function readNumber(value: unknown, paths: string[][]) {
  for (const path of paths) {
    const result = readPath(value, path);

    if (typeof result === "number") {
      return result;
    }

    if (typeof result === "string") {
      const parsed = Number.parseFloat(result);

      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function normalizeSignature(signature: string) {
  return signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;
}

function verifySignature({
  rawBody,
  signature,
  timestamp,
  secret,
}: {
  rawBody: string;
  signature: string;
  timestamp: string;
  secret: string;
}) {
  const signedContent = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret)
    .update(signedContent)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(normalizeSignature(signature), "hex");

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

function summarizeEvent({
  webhookId,
  receivedAt,
  body,
}: {
  webhookId: string;
  receivedAt: string;
  body: WebhookBody;
}) {
  const payload = body.payload;
  const account_id = readString(payload, ["account", "account_id"]);
  const platform_account_id = readString(payload, [
    "account",
    "platform_account_id",
  ]);
  const fan_id =
    readString(payload, ["message", "fan_id"]) ||
    readString(payload, ["fan", "fan_id"]) ||
    readString(payload, ["fan", "id"]);
  const from_id = readString(payload, ["message", "from_id"]);
  const direction: "incoming" | "outgoing" | null =
    from_id && fan_id ? (from_id === fan_id ? "incoming" : "outgoing") : null;
  const amount = readNumber(payload, [
    ["amount"],
    ["price"],
    ["purchase", "amount"],
    ["ppv", "amount"],
    ["tip", "amount"],
    ["transaction", "amount"],
  ]);

  if (body.type === "chat.message") {
    return {
      id: webhookId,
      receivedAt,
      type: body.type,
      account_id,
      platform_account_id,
      fan_id,
      direction,
      amount,
      payload: {
        account_id,
        platform_account_id,
        fan_id,
        from_id,
        incoming: direction === "incoming",
        text: readString(payload, ["message", "text"]),
        created_at: readString(payload, ["message", "created_at"]),
        medias: readPath(payload, ["message", "medias"]),
        raw: payload,
      },
    };
  }

  return {
    id: webhookId,
    receivedAt,
    type: body.type || "unknown",
    account_id,
    platform_account_id,
    fan_id,
    direction,
    amount,
    payload,
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-om-webhook-signature");
  const timestamp = request.headers.get("x-om-webhook-timestamp");
  const webhookId = request.headers.get("x-om-webhook-id");
  const secret = process.env.ONLYMONSTER_WEBHOOK_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return Response.json(
        { error: "Falta configurar ONLYMONSTER_WEBHOOK_SECRET." },
        { status: 500 },
      );
    }

    console.warn(
      "ONLYMONSTER_WEBHOOK_SECRET no está configurado. Evento permitido solo en desarrollo.",
    );
  } else if (!signature || !timestamp || !webhookId) {
    return Response.json({ error: "Firma de webhook incompleta." }, { status: 401 });
  } else if (
    !verifySignature({
      rawBody,
      signature,
      timestamp,
      secret,
    })
  ) {
    return Response.json({ error: "Firma de webhook inválida." }, { status: 401 });
  }

  let body: WebhookBody;

  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }

  const receivedAt = new Date().toISOString();
  const safeWebhookId = webhookId || `dev-${receivedAt}`;
  const event = summarizeEvent({
    webhookId: safeWebhookId,
    receivedAt,
    body,
  });

  addWebhookEvent(event);

  if (handledEvents.has(event.type)) {
    console.info("OnlyMonster webhook received", {
      type: event.type,
      account_id: event.account_id,
      fan_id: event.fan_id,
    });
  } else {
    console.info("OnlyMonster webhook ignored for automation", {
      type: event.type,
      account_id: event.account_id,
      fan_id: event.fan_id,
    });
  }

  return Response.json({ ok: true });
}
