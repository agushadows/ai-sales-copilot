type Transaction = {
  id: string;
  amount: number;
  type: string;
  timestamp: string;
  fan: {
    id: string;
    name?: string;
    username?: string;
    display_name?: string;
    displayName?: string;
    fan_name?: string;
    fanName?: string;
    nickname?: string;
    profile_name?: string;
    avatar?: string;
    avatar_url?: string;
  };
};

function isPPVTransaction(transaction: Transaction) {
  const type = transaction.type.toLowerCase();

  return (
    type.includes("message") ||
    type.includes("ppv") ||
    type.includes("post purchase")
  );
}

function isTipTransaction(transaction: Transaction) {
  return transaction.type.toLowerCase().includes("tip");
}

async function readOnlyMonsterJson(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function extractError(data: unknown, fallback: string) {
  if (typeof data === "object" && data !== null && "message" in data) {
    return String(data.message);
  }

  if (typeof data === "object" && data !== null && "error" in data) {
    return String(data.error);
  }

  if (typeof data === "string" && data) {
    return data;
  }

  return fallback;
}

function retryAfterSeconds(response: Response) {
  const retryAfter = response.headers.get("retry-after");

  if (!retryAfter) {
    return 60;
  }

  const seconds = Number.parseInt(retryAfter, 10);

  if (!Number.isNaN(seconds)) {
    return seconds;
  }

  const retryDate = new Date(retryAfter).getTime();
  const now = Date.now();

  return Number.isNaN(retryDate)
    ? 60
    : Math.max(1, Math.ceil((retryDate - now) / 1000));
}

function readStringField(value: unknown, fields: string[]) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  for (const field of fields) {
    const result = record[field];

    if (typeof result === "string" && result.trim()) {
      return result.trim();
    }
  }

  return null;
}

function getFanProfile(transactions: Transaction[]) {
  for (const transaction of transactions) {
    const name = readStringField(transaction.fan, [
      "name",
      "display_name",
      "displayName",
      "fan_name",
      "fanName",
      "nickname",
      "profile_name",
    ]);
    const username = readStringField(transaction.fan, ["username"]);
    const avatar = readStringField(transaction.fan, ["avatar", "avatar_url"]);

    if (name || username || avatar) {
      return { name, username, avatar };
    }
  }

  return { name: null, username: null, avatar: null };
}

export async function GET(request: Request) {
  const apiKey = request.headers.get("x-om-auth-token");
  const { searchParams } = new URL(request.url);
  const fanId = searchParams.get("fanId");
  const platform = searchParams.get("platform") || "onlyfans";
  const platformAccountId = searchParams.get("platformAccountId");

  if (!apiKey) {
    return Response.json(
      { error: "Falta la API key de OnlyMonster." },
      { status: 400 },
    );
  }

  if (!fanId || !platformAccountId) {
    return Response.json(
      { error: "Falta el fan o la cuenta de plataforma." },
      { status: 400 },
    );
  }

  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);

  const response = await fetch(
    `https://omapi.onlymonster.ai/api/v0/platforms/${platform}/accounts/${platformAccountId}/transactions?start=${start.toISOString()}&end=${end.toISOString()}&limit=1000`,
    {
      headers: {
        "x-om-auth-token": apiKey,
      },
    },
  );
  const data = await readOnlyMonsterJson(response);

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = retryAfterSeconds(response);

      return Response.json(
        {
          error: `Espera ${retryAfter} segundos antes de volver a consultar OnlyMonster.`,
          retryAfter,
        },
        { status: 429 },
      );
    }

    return Response.json(
      {
        error: "No se pudo cargar el gasto",
        technicalStatus: response.status,
        technicalBody: data,
        detail: extractError(data, "OnlyMonster no permitió leer transacciones."),
      },
      { status: response.status },
    );
  }

  const transactions = Array.isArray(data.items) ? data.items : [];
  const fanTransactions = (transactions as Transaction[])
    .filter((transaction) => transaction.fan.id === fanId)
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  const totalSpent = fanTransactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  const ppvTransactions = fanTransactions.filter(isPPVTransaction);
  const tipTransactions = fanTransactions.filter(isTipTransaction);
  const purchaseCount = fanTransactions.length;
  const lastPurchase = fanTransactions[0]
    ? {
        amount: fanTransactions[0].amount,
        date: fanTransactions[0].timestamp,
        type: fanTransactions[0].type,
      }
    : null;
  const typeBlob = fanTransactions
    .map((transaction) => transaction.type.toLowerCase())
    .join(" ");
  const ppvPurchased =
    ppvTransactions.length > 0;
  const tipReceived = tipTransactions.length > 0;
  const subscriptionActive =
    typeBlob.includes("subscription") || typeBlob.includes("subscribe");
  const welcomePPVPurchased =
    typeBlob.includes("welcome") ||
    fanTransactions.some((transaction) =>
      transaction.type.toLowerCase().includes("message"),
    );

  return Response.json({
    totalSpent,
    purchaseCount,
    ppvPurchaseCount: ppvTransactions.length,
    tipCount: tipTransactions.length,
    tipTotal: tipTransactions.reduce(
      (sum, transaction) => sum + transaction.amount,
      0,
    ),
    lastPurchase,
    initialPurchase: purchaseCount > 0,
    welcomePPVPurchased,
    ppvPurchased,
    tipReceived,
    subscriptionActive,
    purchasesAfterWelcome: Math.max(0, purchaseCount - 1),
    transactions: fanTransactions.slice(0, 10),
    fan: getFanProfile(fanTransactions),
    source: "transactions",
  });
}
