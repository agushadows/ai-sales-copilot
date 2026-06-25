import { createHash, randomUUID } from "node:crypto";
import {
  buildFanIntelligenceKey,
  getPersistenceWarning,
  getPersistentJson,
  setPersistentJson,
  type CacheLogContext,
} from "./cache";

type FanMetadata = {
  totalSpent?: number | null;
  initialPurchase?: boolean | null;
  welcomePPVPurchased?: boolean | null;
  ppvPurchased?: boolean | null;
  tipReceived?: boolean | null;
  subscriptionActive?: boolean | null;
  purchaseCount?: number | null;
  lastPurchase?: {
    amount?: number | null;
    date?: string | null;
    type?: string | null;
  } | null;
  avgPPV?: number | null;
  purchasedContent?: string[] | string | null;
  rebillStatus?: string | null;
  purchasesAfterWelcome?: number | null;
};

type FullContextMessage = {
  id: number;
  text: string;
  is_sent_by_me: boolean;
  created_at: string;
  media_count?: number;
  price?: number;
  can_purchase?: boolean;
  type?: string;
};

type HistoryUsed = {
  status: string;
  messagesAnalyzed: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  transactionsIncluded: number;
  historicalSpendIncluded: boolean;
  historicalBlocksSummarized: number;
  messagePages?: number;
  incompleteReason?: string;
  cached?: boolean;
};

type AnalyzeRequest = {
  conversationText?: string;
  sector?: string;
  fanMetadata?: FanMetadata;
  fullContext?: {
    accountId?: string;
    fanId?: string;
    messages?: FullContextMessage[];
    transactions?: unknown[];
    purchaseMetrics?: unknown;
    historyUsed?: HistoryUsed;
    cached?: boolean;
  };
};

type FanIntelligenceProfile = {
  accountId: string;
  fanId: string;
  updatedAt: string;
  lastProcessedMessageAt: string | null;
  lastProcessedMessageHash: string;
  lastProcessedTransactionHash: string;
  profile: unknown;
  blockSummaryCount: number;
};

const ANALYSIS_CACHE_TTL_MS = 60 * 60 * 1000;
const ENDPOINT = "/api/analyze";

const blockSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dateRange: { type: "string" },
    interestLevel: { type: "string" },
    purchasesAndPricesMentioned: { type: "string" },
    ppvSentOrPurchased: { type: "string" },
    preferencesAndInterests: { type: "string" },
    objections: { type: "string" },
    pendingPromisesOrRequests: { type: "string" },
    tone: { type: "string" },
    behaviorChanges: { type: "string" },
    whatWorkedOrFailed: { type: "string" },
    riskSignals: { type: "string" },
  },
  required: [
    "dateRange",
    "interestLevel",
    "purchasesAndPricesMentioned",
    "ppvSentOrPurchased",
    "preferencesAndInterests",
    "objections",
    "pendingPromisesOrRequests",
    "tone",
    "behaviorChanges",
    "whatWorkedOrFailed",
    "riskSignals",
  ],
};

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    buyerType: { type: "string" },
    fanClassification: { type: "string" },
    historicalValue: { type: "string" },
    purchaseIntentScore: { type: "integer", minimum: 0, maximum: 100 },
    purchaseIntentLabel: {
      type: "string",
      enum: ["Muy baja", "Baja", "Media", "Alta", "Muy alta"],
    },
    repurchaseProbability: {
      anyOf: [
        { type: "integer", minimum: 0, maximum: 100 },
        { type: "null" },
      ],
    },
    repurchaseProbabilityLabel: {
      anyOf: [
        {
          type: "string",
          enum: ["Muy baja", "Baja", "Media", "Alta", "Muy alta"],
        },
        { type: "null" },
      ],
    },
    repurchaseInsufficientDataReason: { type: "string" },
    mainMotivation: { type: "string" },
    mainObjection: { type: "string" },
    whatThisFanAlreadyDid: { type: "string" },
    purchaseBreakdown: {
      type: "object",
      additionalProperties: false,
      properties: {
        initialPurchase: { type: "string" },
        welcomePPV: { type: "string" },
        ppvPurchased: { type: "string" },
        tip: { type: "string" },
        subscription: { type: "string" },
        totalSpent: { type: "string" },
        purchaseCount: { type: "string" },
        lastPurchase: { type: "string" },
        purchasesAfterWelcome: { type: "string" },
      },
      required: [
        "initialPurchase",
        "welcomePPV",
        "ppvPurchased",
        "tip",
        "subscription",
        "totalSpent",
        "purchaseCount",
        "lastPurchase",
        "purchasesAfterWelcome",
      ],
    },
    nextBestAction: { type: "string" },
    howToDoIt: { type: "string" },
    whatToAvoid: { type: "string" },
    suggestedMessage: { type: "string" },
    suggestedPPVPrice: { type: "number" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    confidenceLabel: {
      type: "string",
      enum: ["Muy baja", "Baja", "Media", "Alta", "Muy alta"],
    },
    shortReasoning: { type: "string" },
    recommendation: {
      type: "object",
      additionalProperties: false,
      properties: {
        observedSignal: { type: "string" },
        interpretation: { type: "string" },
        recommendedAction: { type: "string" },
        whyThisAction: { type: "string" },
        personalizedSuggestedMessage: { type: "string" },
      },
      required: [
        "observedSignal",
        "interpretation",
        "recommendedAction",
        "whyThisAction",
        "personalizedSuggestedMessage",
      ],
    },
    missingData: { type: "string" },
    historyUsed: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string" },
        messagesAnalyzed: { type: "integer" },
        firstMessageAt: { anyOf: [{ type: "string" }, { type: "null" }] },
        lastMessageAt: { anyOf: [{ type: "string" }, { type: "null" }] },
        transactionsIncluded: { type: "integer" },
        historicalSpendIncluded: { type: "boolean" },
        historicalBlocksSummarized: { type: "integer" },
        messagePages: { type: "integer" },
        incompleteReason: { type: "string" },
        cached: { type: "boolean" },
      },
      required: [
        "status",
        "messagesAnalyzed",
        "firstMessageAt",
        "lastMessageAt",
        "transactionsIncluded",
        "historicalSpendIncluded",
        "historicalBlocksSummarized",
        "messagePages",
        "incompleteReason",
        "cached",
      ],
    },
  },
  required: [
    "buyerType",
    "fanClassification",
    "historicalValue",
    "purchaseIntentScore",
    "purchaseIntentLabel",
    "repurchaseProbability",
    "repurchaseProbabilityLabel",
    "repurchaseInsufficientDataReason",
    "mainMotivation",
    "mainObjection",
    "whatThisFanAlreadyDid",
    "purchaseBreakdown",
    "nextBestAction",
    "howToDoIt",
    "whatToAvoid",
    "suggestedMessage",
    "suggestedPPVPrice",
    "confidence",
    "confidenceLabel",
    "shortReasoning",
    "recommendation",
    "missingData",
    "historyUsed",
  ],
};

const fanProfileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    spending: { type: "string" },
    purchaseTimeline: { type: "string" },
    purchasedPpvs: { type: "string" },
    ignoredOrRejectedOffers: { type: "string" },
    interestsAndFetishes: { type: "string" },
    languageToneAndStyle: { type: "string" },
    objections: { type: "string" },
    purchaseTriggers: { type: "string" },
    priceSensitivity: { type: "string" },
    responseFrequency: { type: "string" },
    fanState: { type: "string" },
    recommendedStrategy: { type: "string" },
    chronologicalHistory: { type: "string" },
    evidence: { type: "string" },
  },
  required: [
    "spending",
    "purchaseTimeline",
    "purchasedPpvs",
    "ignoredOrRejectedOffers",
    "interestsAndFetishes",
    "languageToneAndStyle",
    "objections",
    "purchaseTriggers",
    "priceSensitivity",
    "responseFrequency",
    "fanState",
    "recommendedStrategy",
    "chronologicalHistory",
    "evidence",
  ],
};

function countFanMessages(conversationText: string) {
  return conversationText
    .split("\n")
    .filter((line) => line.trim().toUpperCase().includes("[FAN]")).length;
}

function extractResponseText(data: unknown) {
  if (typeof data !== "object" || data === null) {
    return "";
  }

  if ("output_text" in data && typeof data.output_text === "string") {
    return data.output_text;
  }

  const output = "output" in data ? data.output : null;

  if (!Array.isArray(output)) {
    return "";
  }

  for (const item of output) {
    if (typeof item !== "object" || item === null || !("content" in item)) {
      continue;
    }

    const content = item.content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      if (
        typeof contentItem === "object" &&
        contentItem !== null &&
        "text" in contentItem &&
        typeof contentItem.text === "string"
      ) {
        return contentItem.text;
      }
    }
  }

  return "";
}

function extractOpenAIError(data: unknown) {
  if (typeof data !== "object" || data === null || !("error" in data)) {
    return "OpenAI no pudo analizar la conversación.";
  }

  const error = data.error;

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "OpenAI no pudo analizar la conversación.";
}

function formatMessagesForAnalysis(messages: FullContextMessage[]) {
  return messages
    .map((message) => {
      const speaker = message.is_sent_by_me ? "CREADORA" : "FAN";
      const mediaNote =
        message.media_count && message.media_count > 0
          ? ` [media:${message.media_count}]`
          : "";
      const ppvNote =
        (message.price || 0) > 0 || message.can_purchase
          ? ` [PPV/precio:${message.price || "desconocido"}]`
          : "";

      return `${message.created_at} [${speaker}]${mediaNote}${ppvNote}: ${
        message.text || "[sin texto]"
      }`;
    })
    .join("\n");
}

function chunkMessages(messages: FullContextMessage[], size: number) {
  const chunks: FullContextMessage[][] = [];

  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }

  return chunks;
}

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function logAnalyzeError(error: unknown, context: CacheLogContext) {
  console.error("[analysis-error]", {
    accountId: context.accountId,
    cacheKey: context.cacheKey,
    endpoint: context.endpoint || ENDPOINT,
    fanId: context.fanId,
    message: error instanceof Error ? error.message : String(error),
    phase: context.phase,
    requestId: context.requestId,
    stack: error instanceof Error ? error.stack : undefined,
  });
}

async function callOpenAIJson({
  apiKey,
  input,
  schema,
  schemaName,
}: {
  apiKey: string;
  input: Array<{ role: "system" | "user"; content: string }>;
  schema: object;
  schemaName: string;
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      input,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(extractOpenAIError(data));
  }

  const responseText = extractResponseText(data);

  if (!responseText) {
    throw new Error("OpenAI no devolvió una respuesta válida.");
  }

  return JSON.parse(responseText) as Record<string, unknown>;
}

async function summarizeHistoricalBlocks({
  apiKey,
  cacheContext,
  messages,
}: {
  apiKey: string;
  cacheContext?: CacheLogContext;
  messages: FullContextMessage[];
}) {
  const chunks = chunkMessages(messages, 150);
  const summaries: unknown[] = [];
  let cacheHits = 0;

  for (const chunk of chunks) {
    const blockKey = hashValue({
      type: "block-summary-v1",
      firstId: chunk[0]?.id,
      lastId: chunk[chunk.length - 1]?.id,
      messages: chunk,
    });
    const blockCacheKey = `analysis:block:${blockKey}`;
    const cachedSummary = await getPersistentJson<unknown>(blockCacheKey, {
      ...cacheContext,
      cacheKey: blockCacheKey,
      phase: "cache-read",
    });

    if (cachedSummary) {
      cacheHits += 1;
      summaries.push(cachedSummary);
      continue;
    }

    const summary = await callOpenAIJson({
        apiKey,
        schema: blockSummarySchema,
        schemaName: "historical_conversation_block_summary",
        input: [
          {
            role: "system",
            content:
              "Resume este bloque cronológico de conversación para un análisis de ventas OnlyFans. Conserva fechas cubiertas, nivel de interés, compras/precios mencionados, PPVs enviados o comprados, preferencias/fetiches/intereses, objeciones, promesas o peticiones pendientes, tono, cambios de comportamiento, contenido que funcionó o no funcionó y señales de riesgo. No inventes datos.",
          },
          {
            role: "user",
            content: formatMessagesForAnalysis(chunk),
          },
        ],
      });

    await setPersistentJson(
      blockCacheKey,
      summary,
      ANALYSIS_CACHE_TTL_MS / 1000,
      {
        ...cacheContext,
        cacheKey: blockCacheKey,
        phase: "cache-write",
      },
    );
    summaries.push(summary);
  }

  return { summaries, cacheHits };
}

function getLastMessageHash(messages: FullContextMessage[]) {
  const lastMessage = messages[messages.length - 1] || null;

  return hashValue(
    lastMessage
      ? {
          id: lastMessage.id,
          created_at: lastMessage.created_at,
          text: lastMessage.text,
        }
      : null,
  );
}

function getLastTransactionHash(transactions: unknown[]) {
  return hashValue(transactions[transactions.length - 1] || null);
}

async function buildOrUpdateFanProfile({
  accountId,
  apiKey,
  blockSummaries,
  fanId,
  fullMessages,
  purchaseMetrics,
  requestId,
  transactions,
}: {
  accountId: string;
  apiKey: string;
  blockSummaries: unknown[];
  fanId: string;
  fullMessages: FullContextMessage[];
  purchaseMetrics: unknown;
  requestId: string;
  transactions: unknown[];
}) {
  const profileKey = buildFanIntelligenceKey(accountId, fanId);
  const existingProfile =
    await getPersistentJson<FanIntelligenceProfile>(profileKey, {
      accountId,
      cacheKey: profileKey,
      endpoint: ENDPOINT,
      fanId,
      phase: "profile-read",
      requestId,
    });
  const lastProcessedMessageHash = getLastMessageHash(fullMessages);
  const lastProcessedTransactionHash = getLastTransactionHash(transactions);
  const lastMessageAt = fullMessages[fullMessages.length - 1]?.created_at || null;

  if (
    existingProfile &&
    existingProfile.lastProcessedMessageHash === lastProcessedMessageHash &&
    existingProfile.lastProcessedTransactionHash === lastProcessedTransactionHash
  ) {
    return { profile: existingProfile, changed: false };
  }

  const newMessages = existingProfile?.lastProcessedMessageAt
    ? fullMessages.filter(
        (message) =>
          new Date(message.created_at).getTime() >
          new Date(existingProfile.lastProcessedMessageAt || "").getTime(),
      )
    : fullMessages.slice(-100);
  const profile = await callOpenAIJson({
    apiKey,
    schema: fanProfileSchema,
    schemaName: "fan_intelligence_profile",
    input: [
      {
        role: "system",
        content:
          "Construye o actualiza un fan intelligence profile persistente para ventas OnlyFans. Debe conservar conocimiento histórico: compras antiguas, intereses repetidos, mensajes ignorados, tono, objeciones, evolución, comportamiento de gasto, disparadores de compra y estrategia. No elimines historial antiguo; integra lo nuevo con lo existente.",
      },
      {
        role: "user",
        content: JSON.stringify({
          existingProfile: existingProfile?.profile || null,
          blockSummaries,
          newMessages: formatMessagesForAnalysis(newMessages),
          purchaseMetrics,
          transactions,
        }),
      },
    ],
  });
  const nextProfile: FanIntelligenceProfile = {
    accountId,
    fanId,
    updatedAt: new Date().toISOString(),
    lastProcessedMessageAt: lastMessageAt,
    lastProcessedMessageHash,
    lastProcessedTransactionHash,
    profile,
    blockSummaryCount: blockSummaries.length,
  };

  await setPersistentJson(profileKey, nextProfile, undefined, {
    accountId,
    cacheKey: profileKey,
    endpoint: ENDPOINT,
    fanId,
    phase: "profile-write",
    requestId,
  });

  return { profile: nextProfile, changed: true };
}

function buildFallbackHistory(conversationText: string): HistoryUsed {
  return {
    status: "manual",
    messagesAnalyzed: conversationText.split("\n").filter(Boolean).length,
    firstMessageAt: null,
    lastMessageAt: null,
    transactionsIncluded: 0,
    historicalSpendIncluded: false,
    historicalBlocksSummarized: 0,
    messagePages: 0,
    incompleteReason:
      "No se proporcionó contexto profundo de OnlyMonster; se analizó el texto manual.",
    cached: false,
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const apiKey = process.env.OPENAI_API_KEY;
  let phase = "request-parse";
  let accountId = "unknown";
  let fanId = "unknown";
  let activeCacheKey: string | undefined;

  if (!apiKey) {
    return Response.json(
      { error: "Falta configurar OPENAI_API_KEY en el servidor.", requestId },
      { status: 500 },
    );
  }

  try {
  const body = (await request.json()) as AnalyzeRequest;
  const conversationText = body.conversationText?.trim();
  const sector = body.sector || "OnlyFans";
  const fanMetadata = body.fanMetadata || null;
  const fullContext = body.fullContext || null;
  const fullMessages = fullContext?.messages || [];
  accountId = fullContext?.accountId || "manual";
  fanId = fullContext?.fanId || "manual";
  const persistenceWarning = getPersistenceWarning();
  const warnings = persistenceWarning ? [persistenceWarning] : [];
  const historyUsed: HistoryUsed = fullContext?.historyUsed
    ? {
        ...fullContext.historyUsed,
        historicalBlocksSummarized: 0,
        messagePages: fullContext.historyUsed.messagePages || 0,
        cached: Boolean(fullContext.cached),
      }
    : buildFallbackHistory(conversationText || "");
  const fullConversationText =
    fullMessages.length > 0
      ? formatMessagesForAnalysis(fullMessages)
      : conversationText || "";
  const fanMessageCount = countFanMessages(fullConversationText);

  if (!fullConversationText.trim()) {
    return Response.json(
      { error: "No hay conversación para analizar." },
      { status: 400 },
    );
  }

  let historicalSummaries: unknown[] = [];
  let recentLiteralMessages = fullConversationText;
  let fanIntelligenceProfile: FanIntelligenceProfile | null = null;
  let profileChanged = false;
  const timings: Record<string, number> = {};
  const analysisCacheKey = hashValue({
    type: "analysis-v1",
    sector,
    fanMetadata,
    messages: fullMessages.map((message) => ({
      id: message.id,
      created_at: message.created_at,
      text: message.text,
      is_sent_by_me: message.is_sent_by_me,
      media_count: message.media_count,
      price: message.price,
      can_purchase: message.can_purchase,
    })),
    transactions: fullContext?.transactions || [],
    purchaseMetrics: fullContext?.purchaseMetrics || null,
  });
  activeCacheKey = `analysis:result:${analysisCacheKey}`;
  phase = "cache-read";
  const cachedAnalysis = await getPersistentJson<{
    updatedAt: number;
    value: unknown;
  }>(activeCacheKey, {
    accountId,
    cacheKey: activeCacheKey,
    endpoint: ENDPOINT,
    fanId,
    phase,
    requestId,
  });

  if (
    cachedAnalysis &&
    Date.now() - cachedAnalysis.updatedAt < ANALYSIS_CACHE_TTL_MS
  ) {
    return Response.json({
      ...(cachedAnalysis.value as object),
      analysisCache: {
        hit: true,
        blockSummaryCacheHits: 0,
      },
      requestId,
      warnings,
      timings: {
        totalMs: Date.now() - startedAt,
      },
    });
  }
  let blockSummaryCacheHits = 0;
  const summarizeStartedAt = Date.now();

  if (fullMessages.length > 220) {
    const oldMessages = fullMessages.slice(0, -80);
    const recentMessages = fullMessages.slice(-80);
    const blockSummaryResult = await summarizeHistoricalBlocks({
      apiKey,
      cacheContext: {
        accountId,
        endpoint: ENDPOINT,
        fanId,
        requestId,
      },
      messages: oldMessages,
    });
    historicalSummaries = blockSummaryResult.summaries;
    blockSummaryCacheHits = blockSummaryResult.cacheHits;
    recentLiteralMessages = formatMessagesForAnalysis(recentMessages);
    historyUsed.historicalBlocksSummarized = historicalSummaries.length;
  } else if (fullMessages.length > 0) {
    historicalSummaries = [
      {
        dateRange: `${historyUsed.firstMessageAt || "inicio"} → ${historyUsed.lastMessageAt || "fin"}`,
        summary: "Historial pequeño enviado completo al análisis final.",
      },
    ];
  }
  timings.blockAnalysisMs = Date.now() - summarizeStartedAt;

  if (fullContext?.accountId && fullContext?.fanId) {
    const profileStartedAt = Date.now();
    try {
      phase = "profile-read";
      const profileResult = await buildOrUpdateFanProfile({
        accountId,
        apiKey,
        blockSummaries: historicalSummaries,
        fanId,
        fullMessages,
        purchaseMetrics: fullContext.purchaseMetrics || null,
        requestId,
        transactions: fullContext.transactions || [],
      });
      fanIntelligenceProfile = profileResult.profile;
      profileChanged = profileResult.changed;
    } catch (error) {
      logAnalyzeError(error, {
        accountId,
        endpoint: ENDPOINT,
        fanId,
        phase: "OpenAI",
        requestId,
      });
      warnings.push(
        "Falló la actualización del perfil profundo; el análisis continuó sin bloquearse.",
      );
    }
    timings.profileUpdateMs = Date.now() - profileStartedAt;
  }

  const recommendationStartedAt = Date.now();
  phase = "OpenAI";
  const result = await callOpenAIJson({
    apiKey,
    schema: analysisSchema,
    schemaName: "sales_conversation_analysis",
    input: [
      {
        role: "system",
        content:
          "Actúa como analista de ventas conversacionales para OnlyFans. La fuente principal de conocimiento histórico es fanIntelligenceProfile, que conserva el historial completo procesado incrementalmente. Usa ese perfil profundo junto con mensajes recientes literales y transacciones para generar la recomendación actual. No clasifiques al fan como nuevo si existen mensajes o compras antiguas. Distingue entre intención actual y valor histórico. Una compra de hace semanas o meses sigue siendo relevante para calcular la probabilidad de recompra y la estrategia. No des una respuesta genérica. Si el fan ya compró un PPV o mensaje de bienvenida, considéralo señal de compra real y aumenta la probabilidad de recompra. Si hay compras históricas, nunca afirmes que no compró contenido. Distingue compra inicial/welcome PPV, PPV comprado, tip, suscripción, gasto total, número de compras, primera compra, última compra y compras posteriores a bienvenida. Si no hay datos de compras fiables, dilo como datos de compra no disponibles, no asumas gasto $0. Los scores deben ser enteros 0-100 con etiqueta cualitativa. Devuelve mensaje sugerido en el mismo idioma/tono de la conversación.",
      },
      {
        role: "user",
        content: JSON.stringify({
          sector,
          fanMessageCount,
          fanMetadata,
          historyUsed,
          fanIntelligenceProfile: fanIntelligenceProfile?.profile || null,
          profileChanged,
          purchaseMetrics: fullContext?.purchaseMetrics || null,
          transactions: fullContext?.transactions || [],
          historicalSummaries,
          recentLiteralMessages,
          completeConversationIfSmall:
            fullMessages.length <= 220 ? fullConversationText : null,
        }),
      },
    ],
  });
  timings.recommendationMs = Date.now() - recommendationStartedAt;
  timings.totalMs = Date.now() - startedAt;
  console.info("[deep-analysis] timings", {
    accountId,
    fanId,
    ...timings,
  });

  const responseValue = {
    ...result,
    historyUsed,
    fanIntelligenceProfile: fanIntelligenceProfile?.profile || null,
    profileUpdatedAt: fanIntelligenceProfile?.updatedAt || null,
    analysisCache: {
      hit: false,
      blockSummaryCacheHits,
      profileChanged,
    },
    requestId,
    timings,
    warnings,
  };

  phase = "cache-write";
  await setPersistentJson(activeCacheKey, {
    updatedAt: Date.now(),
    value: responseValue,
  }, ANALYSIS_CACHE_TTL_MS / 1000, {
    accountId,
    cacheKey: activeCacheKey,
    endpoint: ENDPOINT,
    fanId,
    phase,
    requestId,
  });

  return Response.json(responseValue);
  } catch (error) {
    logAnalyzeError(error, {
      accountId,
      cacheKey: activeCacheKey,
      endpoint: ENDPOINT,
      fanId,
      phase,
      requestId,
    });

    const cacheOrProfileFailed =
      phase.includes("cache") || phase.includes("profile");

    return Response.json(
      {
        detail:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
        error: cacheOrProfileFailed
          ? "Falló la caché/perfil, pero puedes reintentar el análisis."
          : error instanceof Error
            ? error.message
            : "Error desconocido al analizar la conversación.",
        phase,
        requestId,
      },
      { status: 500 },
    );
  }
}
