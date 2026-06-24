import { getWebhookEvents } from "../api/webhooks/onlymonster/store";

export const dynamic = "force-dynamic";

function formatAmount(amount: number | null) {
  return amount === null ? "No aplica" : `$${amount.toFixed(2)}`;
}

export default function WebhooksDebugPage() {
  const events = getWebhookEvents();

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-16 text-white">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <div className="space-y-3 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Webhooks Debug
          </h1>
          <p className="text-zinc-400">
            Últimos {events.length} eventos recibidos de OnlyMonster.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {events.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center text-zinc-400">
              Todavía no hay eventos recibidos.
            </div>
          ) : null}

          {events.map((event) => (
            <article
              key={event.id}
              className="rounded-2xl border border-white/10 bg-white/5 p-5"
            >
              <div className="grid gap-4 text-sm text-zinc-300 md:grid-cols-3">
                <div>
                  <p className="text-zinc-500">Recibido</p>
                  <p>{event.receivedAt}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Type</p>
                  <p>{event.type}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Dirección</p>
                  <p>{event.direction || "No aplica"}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Account ID</p>
                  <p className="break-all">{event.account_id || "No disponible"}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Fan ID</p>
                  <p className="break-all">{event.fan_id || "No disponible"}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Importe</p>
                  <p>{formatAmount(event.amount)}</p>
                </div>
              </div>

              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-semibold text-white">
                  Payload JSON
                </summary>
                <pre className="mt-4 max-h-96 overflow-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs leading-5 text-zinc-200">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </details>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
