"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Account = {
  id: string;
  name: string;
  platform: string;
  username: string;
  platform_account_id: string;
};

export default function ConnectPage() {
  const [mounted, setMounted] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [status, setStatus] = useState("Cargando cuenta...");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMounted(true);

      const savedApiKey = localStorage.getItem("onlymonster_api_key");
      const savedAccount = localStorage.getItem("onlymonster_selected_account");

      if (savedApiKey) {
        setApiKey(savedApiKey);
      }

      if (savedAccount) {
        const account = JSON.parse(savedAccount) as Account;
        setSelectedAccountId(account.id);
        setStatus("Conectado correctamente");
        return;
      }

      setStatus("No conectado");
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  async function testConnection() {
    setError("");
    setAccounts([]);

    if (!apiKey.trim()) {
      setStatus("No conectado");
      setError("Pega una API key antes de probar la conexión.");
      return;
    }

    setIsLoading(true);
    setStatus("Probando conexión...");

    try {
      const response = await fetch("/api/onlymonster/accounts", {
        method: "GET",
        headers: {
          "x-om-auth-token": apiKey.trim(),
        },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "No se pudo conectar con OnlyMonster.");
      }

      const nextAccounts = data.accounts || [];
      setAccounts(nextAccounts);
      setStatus("Conectado correctamente");
      localStorage.setItem("onlymonster_api_key", apiKey.trim());

      if (nextAccounts.length > 0) {
        selectAccount(nextAccounts[0]);
      }
    } catch (connectionError) {
      setStatus("No conectado");
      setError(
        connectionError instanceof Error
          ? connectionError.message
          : "Error desconocido al conectar con OnlyMonster.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function selectAccount(account: Account) {
    setSelectedAccountId(account.id);
    localStorage.setItem("onlymonster_selected_account", JSON.stringify(account));
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-16 text-white">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <div className="space-y-3 text-center">
          <h1 className="text-4xl font-bold tracking-tight">
            Conectar OnlyMonster
          </h1>
          <p className="text-zinc-400">Estado: {status}</p>
        </div>

        <label className="flex flex-col gap-2 text-sm font-medium text-zinc-200">
          OnlyMonster API Key
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="OnlyMonster API Key"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-zinc-500 focus:border-white/30"
          />
        </label>

        <button
          type="button"
          onClick={testConnection}
          disabled={isLoading}
          className="rounded-full bg-white px-6 py-3 font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Probando conexión..." : "Probar conexión"}
        </button>

        {error ? (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {accounts.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {accounts.map((account) => (
              <button
                type="button"
                key={account.id}
                onClick={() => selectAccount(account)}
                className={`rounded-2xl border p-5 text-left transition ${
                  selectedAccountId === account.id
                    ? "border-white/50 bg-white/10"
                    : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{account.name}</h2>
                  {selectedAccountId === account.id ? (
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-950">
                      Seleccionada
                    </span>
                  ) : null}
                </div>
                <dl className="mt-4 space-y-2 text-sm text-zinc-300">
                  <div>
                    <dt className="text-zinc-500">Username</dt>
                    <dd>{account.username}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Platform Account ID</dt>
                    <dd className="break-all">{account.platform_account_id}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">ID</dt>
                    <dd className="break-all">{account.id}</dd>
                  </div>
                </dl>
              </button>
            ))}
          </div>
        ) : null}

        {mounted && selectedAccountId ? (
          <Link
            href="/chats"
            className="rounded-full border border-white/30 px-6 py-3 text-center font-semibold text-white transition hover:bg-white/10"
          >
            Ir a conversaciones
          </Link>
        ) : null}
      </section>
    </main>
  );
}
