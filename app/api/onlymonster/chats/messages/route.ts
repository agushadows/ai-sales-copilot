type OnlyMonsterMessage = {
  id: number;
  text: string;
  from_user: number | Record<string, unknown>;
  is_sent_by_me: boolean;
  created_at: string;
  price: number;
  is_free: boolean;
  fan?: Record<string, unknown>;
  user?: Record<string, unknown>;
  from?: Record<string, unknown>;
  sender?: Record<string, unknown>;
  author?: Record<string, unknown>;
};

type Transaction = {
  amount: number;
  fan: {
    id: string;
  };
};

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

function decodeHtmlEntities(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(
        isHex ? entity.slice(2) : entity.slice(1),
        isHex ? 16 : 10,
      );

      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    return entities[entity.toLowerCase()] || match;
  });
}

function cleanMessageText(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
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

function getFanProfile(messages: OnlyMonsterMessage[]) {
  for (const message of messages) {
    if (message.is_sent_by_me) {
      continue;
    }

    const sources = [
      message.fan,
      message.user,
      message.from_user,
      message.from,
      message.sender,
      message.author,
    ];

    for (const source of sources) {
      const name = readStringField(source, [
        "name",
        "display_name",
        "displayName",
        "fan_name",
        "fanName",
        "nickname",
        "profile_name",
      ]);
      const username = readStringField(source, ["username"]);
      const avatar = readStringField(source, ["avatar", "avatar_url"]);

      if (name || username || avatar) {
        return { name, username, avatar };
      }
    }
  }

  return { name: null, username: null, avatar: null };
}

export async function GET(request: Request) {
  const apiKey = request.headers.get("x-om-auth-token");
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const chatId = searchParams.get("chatId");
  const platform = searchParams.get("platform") || "onlyfans";
  const platformAccountId = searchParams.get("platformAccountId");
  const includeSpending = searchParams.get("includeSpending") === "true";

  if (!apiKey) {
    return Response.json(
      { error: "Falta la API key de OnlyMonster." },
      { status: 400 },
    );
  }

  if (!accountId || !chatId) {
    return Response.json(
      { error: "Falta la cuenta o conversación seleccionada." },
      { status: 400 },
    );
  }

  const response = await fetch(
    `https://omapi.onlymonster.ai/api/v0/accounts/${accountId}/chats/${chatId}/messages?limit=50&order=desc`,
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
        error: extractError(
          data,
          "OnlyMonster no permitió leer mensajes de esta conversación.",
        ),
      },
      { status: response.status },
    );
  }

  const messages = Array.isArray(data.items)
    ? (data.items as OnlyMonsterMessage[])
        .map((message) => ({
          ...message,
          text: cleanMessageText(message.text || ""),
        }))
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
    : [];
  const debugRawMessages = Array.isArray(data.items) ? data.items.slice(0, 2) : [];

  let totalSpent: number | null = null;

  if (includeSpending && platformAccountId) {
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);

    const transactionsResponse = await fetch(
      `https://omapi.onlymonster.ai/api/v0/platforms/${platform}/accounts/${platformAccountId}/transactions?start=${start.toISOString()}&end=${end.toISOString()}&limit=1000`,
      {
        headers: {
          "x-om-auth-token": apiKey,
        },
      },
    );

    if (transactionsResponse.status === 429) {
      const retryAfter = retryAfterSeconds(transactionsResponse);

      return Response.json(
        {
          error: `Espera ${retryAfter} segundos antes de volver a consultar OnlyMonster.`,
          retryAfter,
        },
        { status: 429 },
      );
    }

    if (transactionsResponse.ok) {
      const transactionsData = await readOnlyMonsterJson(transactionsResponse);
      const transactions = Array.isArray(transactionsData.items)
        ? transactionsData.items
        : [];

      totalSpent = (transactions as Transaction[])
        .filter((transaction) => transaction.fan.id === chatId)
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    }
  }

  return Response.json({
    messages,
    debugRawMessages,
    fan: getFanProfile(messages),
    totalSpent,
  });
}
