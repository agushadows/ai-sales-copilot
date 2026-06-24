export type OnlyMonsterWebhookEvent = {
  id: string;
  receivedAt: string;
  type: string;
  account_id: string | null;
  platform_account_id: string | null;
  fan_id: string | null;
  direction: "incoming" | "outgoing" | null;
  amount: number | null;
  payload: unknown;
};

type WebhookStore = {
  events: OnlyMonsterWebhookEvent[];
  ids: Set<string>;
};

const globalForWebhooks = globalThis as typeof globalThis & {
  onlyMonsterWebhookStore?: WebhookStore;
};

export const webhookStore =
  globalForWebhooks.onlyMonsterWebhookStore ||
  (globalForWebhooks.onlyMonsterWebhookStore = {
    events: [],
    ids: new Set<string>(),
  });

export function addWebhookEvent(event: OnlyMonsterWebhookEvent) {
  if (webhookStore.ids.has(event.id)) {
    return;
  }

  webhookStore.events.unshift(event);
  webhookStore.ids.add(event.id);

  if (webhookStore.events.length > 100) {
    const removed = webhookStore.events.splice(100);

    for (const removedEvent of removed) {
      webhookStore.ids.delete(removedEvent.id);
    }
  }
}

export function getWebhookEvents() {
  return webhookStore.events;
}
