import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-white">
      <section className="flex max-w-3xl flex-col items-center gap-8 text-center">
        <div className="space-y-4">
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
            AI Sales Copilot
          </h1>
          <p className="text-xl text-zinc-300 sm:text-2xl">
            Analiza chats de OnlyFans con IA
          </p>
        </div>

        <div className="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
          <Link
            href="/connect"
            className="rounded-full bg-white px-6 py-3 font-semibold text-zinc-950 transition hover:bg-zinc-200"
          >
            Conectar OnlyMonster
          </Link>
          <Link
            href="/analyze"
            className="rounded-full border border-white/30 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
          >
            Analizar Chat
          </Link>
        </div>
      </section>
    </main>
  );
}
