import { getWebhookEvents } from "../store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ events: getWebhookEvents() });
}
