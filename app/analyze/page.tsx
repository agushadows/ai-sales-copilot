"use client";

import { useEffect, useState } from "react";

type AnalysisResult = {
  buyerType: string;
  purchaseIntentScore: number;
  purchaseIntentLabel: string;
  repurchaseProbability: number | null;
  repurchaseProbabilityLabel: string | null;
  repurchaseInsufficientDataReason: string;
  mainMotivation: string;
  mainObjection: string;
  whatThisFanAlreadyDid: string;
  purchaseBreakdown: Record<string, string>;
  nextBestAction: string;
  howToDoIt: string;
  whatToAvoid: string;
  suggestedMessage: string;
  suggestedPPVPrice: number;
  confidence: number;
  confidenceLabel: string;
  shortReasoning: string;
  recommendation: {
    observedSignal: string;
    interpretation: string;
    recommendedAction: string;
    whyThisAction: string;
    personalizedSuggestedMessage: string;
  };
  missingData: string;
  requestId?: string;
  warnings?: string[];
};

const purchaseBreakdownLabels: Record<string, string> = {
  initialPurchase: "Compra inicial",
  welcomePPV: "Welcome PPV",
  ppvPurchased: "PPV comprado",
  tip: "Tip",
  subscription: "Suscripción",
  totalSpent: "Gasto total",
  purchaseCount: "Número de compras",
  lastPurchase: "Última compra",
  purchasesAfterWelcome: "Compras posteriores a la bienvenida",
};

function scoreWithLabel(score: number, label: string) {
  return `${Math.round(score)}% · ${label}`;
}

export default function AnalyzePage() {
  const [conversation, setConversation] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setConversation(localStorage.getItem("analysis_conversation") || "");
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  async function analyzeConversation() {
    setError("");
    setResult(null);

    if (!conversation.trim()) {
      setError("Pega una conversación antes de analizar.");
      return;
    }

    setIsLoading(true);

    try {
      const savedFanMetadata = localStorage.getItem("analysis_fan_metadata");
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationText: conversation,
          sector: "OnlyFans",
          fanMetadata: savedFanMetadata ? JSON.parse(savedFanMetadata) : null,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        const devRequestId =
          process.env.NODE_ENV === "development" && data.requestId
            ? ` ID de diagnóstico: ${data.requestId}.`
            : "";
        const detail =
          process.env.NODE_ENV === "development" && data.detail
            ? ` Detalle: ${data.detail}`
            : "";

        throw new Error(
          `${data.error || "No se pudo analizar la conversación."}${devRequestId}${detail}`,
        );
      }

      setResult(data);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Error desconocido al analizar la conversación.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-16 text-white">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <div className="space-y-3 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Analizador de Chat
          </h1>
        </div>

        <div className="flex flex-col gap-5">
          <textarea
            value={conversation}
            onChange={(event) => setConversation(event.target.value)}
            placeholder="Pega aquí la conversación..."
            className="min-h-72 resize-y rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-base leading-7 text-white outline-none transition placeholder:text-zinc-500 focus:border-white/30"
          />

          <button
            type="button"
            onClick={analyzeConversation}
            disabled={isLoading}
            className="rounded-full bg-white px-6 py-3 font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Analizando conversación..." : "Analizar conversación"}
          </button>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {result.warnings?.length ? (
              <article className="rounded-2xl border border-yellow-300/20 bg-yellow-500/10 p-5 text-yellow-100 sm:col-span-2">
                <h2 className="text-sm font-medium text-yellow-200/80">
                  Aviso
                </h2>
                {result.warnings.map((warning) => (
                  <p key={warning} className="mt-2">
                    {warning}
                  </p>
                ))}
                {process.env.NODE_ENV === "development" &&
                result.requestId ? (
                  <p className="mt-2 text-xs text-yellow-100/70">
                    ID de diagnóstico: {result.requestId}
                  </p>
                ) : null}
              </article>
            ) : null}
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-medium text-zinc-400">
                Tipo de comprador
              </h2>
              <p className="mt-2 text-lg font-semibold text-white">
                {result.buyerType}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-medium text-zinc-400">
                Intención de compra
              </h2>
              <p className="mt-2 text-lg font-semibold text-white">
                {scoreWithLabel(
                  result.purchaseIntentScore,
                  result.purchaseIntentLabel,
                )}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-medium text-zinc-400">
                Probabilidad de recompra
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-lg font-semibold text-white">
                {result.repurchaseProbability === null
                  ? `Datos insuficientes para estimar\n${result.repurchaseInsufficientDataReason}`
                  : scoreWithLabel(
                      result.repurchaseProbability,
                      result.repurchaseProbabilityLabel || "Media",
                    )}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-medium text-zinc-400">Confianza</h2>
              <p className="mt-2 text-lg font-semibold text-white">
                {scoreWithLabel(result.confidence, result.confidenceLabel)}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:col-span-2">
              <h2 className="text-sm font-medium text-zinc-400">
                Qué hizo ya este fan
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-lg font-semibold text-white">
                {result.whatThisFanAlreadyDid}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:col-span-2">
              <h2 className="text-sm font-medium text-zinc-400">
                Desglose de compras
              </h2>
              <dl className="mt-3 grid gap-3 text-sm text-zinc-200 sm:grid-cols-2">
                {Object.entries(purchaseBreakdownLabels).map(([key, label]) => (
                  <div key={key}>
                    <dt className="text-zinc-500">{label}</dt>
                    <dd>{result.purchaseBreakdown[key]}</dd>
                  </div>
                ))}
              </dl>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-medium text-zinc-400">
                Motivación principal
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-lg font-semibold text-white">
                {result.mainMotivation}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-medium text-zinc-400">
                Objeción principal
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-lg font-semibold text-white">
                {result.mainObjection}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:col-span-2">
              <h2 className="text-sm font-medium text-zinc-400">
                Recomendación
              </h2>
              <dl className="mt-3 space-y-3 text-sm text-zinc-200">
                <div>
                  <dt className="text-zinc-500">Señal observada</dt>
                  <dd>{result.recommendation.observedSignal}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Interpretación</dt>
                  <dd>{result.recommendation.interpretation}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Acción recomendada</dt>
                  <dd>{result.recommendation.recommendedAction}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Por qué esa acción</dt>
                  <dd>{result.recommendation.whyThisAction}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Mensaje sugerido personalizado</dt>
                  <dd className="whitespace-pre-wrap">
                    {result.recommendation.personalizedSuggestedMessage}
                  </dd>
                </div>
              </dl>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-medium text-zinc-400">
                Precio PPV sugerido
              </h2>
              <p className="mt-2 text-lg font-semibold text-white">
                ${result.suggestedPPVPrice}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-medium text-zinc-400">Qué evitar</h2>
              <p className="mt-2 whitespace-pre-wrap text-lg font-semibold text-white">
                {result.whatToAvoid}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:col-span-2">
              <h2 className="text-sm font-medium text-zinc-400">
                Razonamiento breve
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-lg font-semibold text-white">
                {result.shortReasoning}
              </p>
            </article>
            {result.missingData ? (
              <article className="rounded-2xl border border-yellow-400/30 bg-yellow-500/10 p-5 sm:col-span-2">
                <h2 className="text-sm font-medium text-yellow-100">
                  Datos faltantes
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-lg font-semibold text-yellow-50">
                  {result.missingData}
                </p>
              </article>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
