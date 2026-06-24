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

type AnalyzeRequest = {
  conversationText?: string;
  sector?: string;
  fanMetadata?: FanMetadata;
};

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    buyerType: { type: "string" },
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
  },
  required: [
    "buyerType",
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
  ],
};

function countFanMessages(conversationText: string) {
  return conversationText
    .split("\n")
    .filter((line) => line.trim().toUpperCase().startsWith("[FAN]:")).length;
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

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "Falta configurar OPENAI_API_KEY en el servidor." },
      { status: 500 },
    );
  }

  const body = (await request.json()) as AnalyzeRequest;
  const conversationText = body.conversationText?.trim();
  const sector = body.sector || "OnlyFans";
  const fanMetadata = body.fanMetadata || null;
  const fanMessageCount = conversationText ? countFanMessages(conversationText) : 0;

  if (!conversationText) {
    return Response.json(
      { error: "Pega una conversación antes de analizar." },
      { status: 400 },
    );
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "Actúa como analista de ventas conversacionales para OnlyFans. Analiza la conversación y datos del fan. No des una respuesta genérica. Si el fan ya compró un PPV o mensaje de bienvenida, considéralo señal de compra real y aumenta la probabilidad de recompra. Si fanMetadata indica welcomePPVPurchased=true, whatThisFanAlreadyDid debe decir explícitamente que compró el welcome PPV, nunca afirmes que no compró contenido, y buyerType debe clasificarlo como nuevo comprador. Distingue compra inicial/welcome PPV, PPV comprado, tip, suscripción, gasto total, número de compras, última compra con importe y fecha, y compras posteriores a la bienvenida. Si hay menos de 8 mensajes del fan o no hay datos de compras fiables, repurchaseProbability y repurchaseProbabilityLabel deben ser null, repurchaseInsufficientDataReason debe explicar exactamente qué falta, y no debes inventar probabilidad de recompra. Los scores purchaseIntentScore y confidence deben ser enteros de 0 a 100 sin decimales y con etiqueta cualitativa. Para la recomendación devuelve señal observada, interpretación, acción recomendada, por qué esa acción y mensaje sugerido personalizado usando el último interés real o compra real. Da el mensaje sugerido en el mismo idioma/tono de la conversación.",
        },
        {
          role: "user",
          content: JSON.stringify({
            sector,
            fanMessageCount,
            fanMetadata,
            conversationText,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "sales_conversation_analysis",
          strict: true,
          schema: analysisSchema,
        },
      },
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    return Response.json(
      { error: extractOpenAIError(data) },
      { status: response.status },
    );
  }

  const responseText = extractResponseText(data);

  if (!responseText) {
    return Response.json(
      { error: "OpenAI no devolvió un análisis válido." },
      { status: 502 },
    );
  }

  try {
    return Response.json(JSON.parse(responseText));
  } catch {
    return Response.json(
      { error: "OpenAI devolvió una respuesta que no se pudo leer como JSON." },
      { status: 502 },
    );
  }
}
