import {
  buildFullContextCacheKey,
  fullContextCache,
} from "./cache";

export const runtime = "nodejs";

const FULL_CONTEXT_CACHE_TTL_MS = 60 * 60 * 1000;
const FULL_CONTEXT_CACHE_VERSION = 2;
const MESSAGE_LIMIT = 100;
const TRANSACTION_LIMIT = 1000;

type OnlyMonsterMessage = {
  id: number;
  text: string;
  from_user: number;
  is_sent_by_me: boolean;
  created_at: string;
  media?: unknown[];
  media_count?: number;
  price?: number;
  is_free?: boolean;
  can_purchase?: boolean;
  can_purchase_reason?: string;
};

type Transaction = {
  id: string;
  amount: number;
  type: string;
  status: string;
  timestamp: string;
  fan: {
    id: string;
  };
};

type MessagePageDiagnostic = {
  page: number;
  requestParam: string | null;
  messagesReceived: number;
  oldestMessageAt: string | null;
  newestMessageAt: string | null;
  oldestMessageId: number | null;
  newestMessageId: number | null;
  responseKeys: string[];
  paginationFields: Record<string, unknown>;
  nextParamName: string | null;
  nextParamValue: string | number | null;
  totalAccumulated: number;
};

async function readOnlyMonsterJson(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
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

function getDateRange(messages: Array<{ created_at: string }>) {
  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];

  return {
    firstMessageAt: firstMessage?.created_at || null,
    lastMessageAt: lastMessage?.created_at || null,
  };
}

function readPath(value: unknown, path: string[]) {
  let current = value;

  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function readFirstPaginationValue(data: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = readPath(data, path);

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
  }

  return null;
}

function getMessagePageRange(pageItems: OnlyMonsterMessage[]) {
  const sortedItems = [...pageItems].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const oldestMessage = sortedItems[0] || null;
  const newestMessage = sortedItems[sortedItems.length - 1] || null;

  return {
    oldestMessage,
    newestMessage,
  };
}

function buildMessagePaginationDiagnostic({
  data,
  fanId,
  page,
  pageItems,
  requestMessageId,
  totalAccumulated,
}: {
  data: unknown;
  fanId: string;
  page: number;
  pageItems: OnlyMonsterMessage[];
  requestMessageId: number | null;
  totalAccumulated: number;
}) {
  const responseRecord =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : {};
  const { oldestMessage, newestMessage } = getMessagePageRange(pageItems);
  const hasMore = readFirstPaginationValue(data, [
    ["has_more"],
    ["hasMore"],
    ["meta", "has_more"],
    ["meta", "hasMore"],
  ]);
  const cursor = readFirstPaginationValue(data, [
    ["cursor"],
    ["next_cursor"],
    ["nextCursor"],
    ["meta", "cursor"],
    ["meta", "next_cursor"],
    ["meta", "nextCursor"],
    ["links", "next"],
    ["next"],
  ]);
  const total = readFirstPaginationValue(data, [
    ["total"],
    ["total_count"],
    ["totalCount"],
    ["meta", "total"],
    ["meta", "total_count"],
    ["meta", "totalCount"],
  ]);
  const paginationFields: Record<string, unknown> = {};

  for (const [key, value] of Object.entries({
    has_more: responseRecord.has_more,
    hasMore: responseRecord.hasMore,
    cursor: responseRecord.cursor,
    next_cursor: responseRecord.next_cursor,
    nextCursor: responseRecord.nextCursor,
    next: responseRecord.next,
    total: responseRecord.total,
    total_count: responseRecord.total_count,
    totalCount: responseRecord.totalCount,
    meta: responseRecord.meta,
    links: responseRecord.links,
  })) {
    if (value !== undefined) {
      paginationFields[key] = value;
    }
  }

  const fallbackNextMessageId = oldestMessage?.id ?? null;
  const nextParamValue =
    cursor !== null
      ? cursor
      : hasMore === true && fallbackNextMessageId !== null
        ? fallbackNextMessageId
        : null;
  const nextParamName =
    cursor !== null ? "cursor/next_cursor" : nextParamValue ? "message_id" : null;

  console.info(
    `[deep-analysis] fan ${fanId} page ${page}: ${pageItems.length} msgs, oldest ${oldestMessage?.created_at || "n/a"}, newest ${newestMessage?.created_at || "n/a"}, nextCursor=${String(nextParamValue || "none")}, total=${totalAccumulated}`,
  );

  return {
    diagnostic: {
      page,
      requestParam:
        requestMessageId === null ? null : `message_id=${requestMessageId}`,
      messagesReceived: pageItems.length,
      oldestMessageAt: oldestMessage?.created_at || null,
      newestMessageAt: newestMessage?.created_at || null,
      oldestMessageId: oldestMessage?.id || null,
      newestMessageId: newestMessage?.id || null,
      responseKeys: Object.keys(responseRecord),
      paginationFields,
      nextParamName,
      nextParamValue:
        typeof nextParamValue === "string" || typeof nextParamValue === "number"
          ? nextParamValue
          : null,
      totalAccumulated,
    } satisfies MessagePageDiagnostic,
    hasMore,
    cursor,
    total,
    nextMessageId: fallbackNextMessageId,
  };
}

async function fetchAllMessages({
  accountId,
  apiKey,
  fanId,
}: {
  accountId: string;
  apiKey: string;
  fanId: string;
}) {
  const messagesById = new Map<number, OnlyMonsterMessage>();
  let nextMessageId: number | null = null;
  let page = 0;
  let complete = true;
  let incompleteReason = "";
  const diagnostics: MessagePageDiagnostic[] = [];
  const requestedMessageIds = new Set<number>();

  while (true) {
    page += 1;
    const params = new URLSearchParams({
      limit: String(MESSAGE_LIMIT),
      order: "desc",
    });

    if (nextMessageId !== null) {
      params.set("message_id", String(nextMessageId));
      requestedMessageIds.add(nextMessageId);
    }

    const response = await fetch(
      `https://omapi.onlymonster.ai/api/v0/accounts/${accountId}/chats/${fanId}/messages?${params}`,
      {
        headers: {
          "x-om-auth-token": apiKey,
        },
      },
    );
    const data = await readOnlyMonsterJson(response);

    if (!response.ok) {
      if (response.status === 429) {
        return {
          messages: Array.from(messagesById.values()),
          complete: false,
          pageCount: page,
          error: `Rate limit OnlyMonster. Espera ${retryAfterSeconds(response)} segundos.`,
          retryAfter: retryAfterSeconds(response),
        };
      }

      complete = false;
      incompleteReason = extractError(
        data,
        "OnlyMonster no permitió leer todo el historial de mensajes.",
      );
      break;
    }

    const pageItems = Array.isArray(data.items)
      ? (data.items as OnlyMonsterMessage[])
      : [];

    for (const message of pageItems) {
      if (typeof message.id === "number") {
        messagesById.set(message.id, message);
      }
    }

    const {
      diagnostic,
      hasMore,
      cursor,
      nextMessageId: proposedNextMessageId,
    } = buildMessagePaginationDiagnostic({
      data,
      fanId,
      page,
      pageItems,
      requestMessageId: nextMessageId,
      totalAccumulated: messagesById.size,
    });
    diagnostics.push(diagnostic);

    if (pageItems.length === 0) {
      break;
    }

    const hasMoreMessages =
      hasMore === true || hasMore === "true" || hasMore === 1;

    if (hasMore === null && cursor === null) {
      if (pageItems.length >= MESSAGE_LIMIT || messagesById.size <= 50) {
        complete = false;
        incompleteReason = `OnlyMonster no devolvió paginación; análisis limitado a ${messagesById.size} mensajes.`;
      }

      break;
    }

    if (!hasMoreMessages && cursor === null) {
      break;
    }

    if (cursor !== null) {
      complete = false;
      incompleteReason =
        "OnlyMonster devolvió cursor/next_cursor, pero el endpoint documentado de mensajes usa message_id para mensajes antiguos.";
      break;
    }

    if (!proposedNextMessageId) {
      complete = false;
      incompleteReason = "La paginación de mensajes no avanzó.";
      break;
    }

    if (requestedMessageIds.has(proposedNextMessageId)) {
      complete = false;
      incompleteReason = "La paginación devolvió un cursor repetido.";
      break;
    }

    nextMessageId = Number(proposedNextMessageId);
  }

  const messages = Array.from(messagesById.values())
    .map((message) => ({
      id: message.id,
      text: cleanMessageText(message.text || ""),
      from_user: message.from_user,
      is_sent_by_me: message.is_sent_by_me,
      created_at: message.created_at,
      media: message.media || [],
      media_count: message.media_count || 0,
      price: typeof message.price === "number" ? message.price : 0,
      is_free: Boolean(message.is_free),
      can_purchase: Boolean(message.can_purchase),
      can_purchase_reason: message.can_purchase_reason || "",
      type: message.media_count ? "media" : "text",
    }))
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

  return {
    messages,
    complete,
    pageCount: page,
    error: incompleteReason,
    diagnostics,
  };
}

async function fetchAllTransactions({
  apiKey,
  fanId,
  platform,
  platformAccountId,
}: {
  apiKey: string;
  fanId: string;
  platform: string;
  platformAccountId: string;
}) {
  const end = new Date();
  const start = new Date("2016-01-01T00:00:00.000Z");
  const transactionsById = new Map<string, Transaction>();
  let cursor: string | null = null;
  let page = 0;
  let complete = true;
  let error = "";

  while (true) {
    page += 1;
    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      limit: String(TRANSACTION_LIMIT),
    });

    if (cursor) {
      params.set("cursor", cursor);
    }

    const response = await fetch(
      `https://omapi.onlymonster.ai/api/v0/platforms/${platform}/accounts/${platformAccountId}/transactions?${params}`,
      {
        headers: {
          "x-om-auth-token": apiKey,
        },
      },
    );
    const data = await readOnlyMonsterJson(response);

    if (!response.ok) {
      complete = false;
      error =
        response.status === 429
          ? `Rate limit OnlyMonster. Espera ${retryAfterSeconds(response)} segundos.`
          : extractError(data, "OnlyMonster no permitió leer transacciones.");
      break;
    }

    const pageItems = Array.isArray(data.items)
      ? (data.items as Transaction[])
      : [];

    for (const transaction of pageItems) {
      if (transaction.fan?.id === fanId && transaction.id) {
        transactionsById.set(transaction.id, transaction);
      }
    }

    const nextCursor =
      typeof data === "object" &&
      data !== null &&
      "cursor" in data &&
      typeof data.cursor === "string" &&
      data.cursor
        ? data.cursor
        : null;

    if (!nextCursor || nextCursor === cursor) {
      break;
    }

    cursor = nextCursor;
  }

  const transactions = Array.from(transactionsById.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const ppvTransactions = transactions.filter(isPPVTransaction);
  const tipTransactions = transactions.filter(isTipTransaction);
  const totalSpent = transactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  const firstPurchase = transactions[0] || null;
  const lastPurchase = transactions[transactions.length - 1] || null;

  return {
    transactions,
    complete,
    pageCount: page,
    error,
    metrics: {
      totalSpent,
      purchaseCount: transactions.length,
      ppvPurchaseCount: ppvTransactions.length,
      ppvSentCount: 0,
      tipCount: tipTransactions.length,
      tipTotal: tipTransactions.reduce(
        (sum, transaction) => sum + transaction.amount,
        0,
      ),
      firstPurchase: firstPurchase
        ? {
            amount: firstPurchase.amount,
            date: firstPurchase.timestamp,
            type: firstPurchase.type,
          }
        : null,
      lastPurchase: lastPurchase
        ? {
            amount: lastPurchase.amount,
            date: lastPurchase.timestamp,
            type: lastPurchase.type,
          }
        : null,
      welcomePPVPurchased: transactions.some((transaction) => {
        const type = transaction.type.toLowerCase();

        return type.includes("welcome") || type.includes("message");
      }),
      frequency:
        transactions.length > 1 && firstPurchase && lastPurchase
          ? `${transactions.length} compras entre ${firstPurchase.timestamp} y ${lastPurchase.timestamp}`
          : transactions.length === 1
            ? "1 compra histórica"
            : "Sin compras confirmadas",
      daysSinceLastPurchase: lastPurchase
        ? Math.floor(
            (Date.now() - new Date(lastPurchase.timestamp).getTime()) /
              86_400_000,
          )
        : null,
      purchasedContent: transactions.map((transaction) => ({
        id: transaction.id,
        amount: transaction.amount,
        type: transaction.type,
        date: transaction.timestamp,
        status: transaction.status,
      })),
    },
  };
}

export async function GET(request: Request) {
  const apiKey = request.headers.get("x-om-auth-token");
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const fanId = searchParams.get("fanId");
  const platform = searchParams.get("platform") || "onlyfans";
  const platformAccountId = searchParams.get("platformAccountId");

  if (!apiKey) {
    return Response.json(
      { error: "Falta la API key de OnlyMonster." },
      { status: 400 },
    );
  }

  if (!accountId || !fanId || !platformAccountId) {
    return Response.json(
      { error: "Falta cuenta, fan o cuenta de plataforma." },
      { status: 400 },
    );
  }

  const cacheKey = buildFullContextCacheKey({
    accountId,
    fanId,
    platformAccountId,
  });
  const cachedEntry = fullContextCache.entries.get(cacheKey);

  if (
    cachedEntry &&
    Date.now() - cachedEntry.updatedAt < FULL_CONTEXT_CACHE_TTL_MS &&
    (cachedEntry.value as { contextVersion?: number }).contextVersion ===
      FULL_CONTEXT_CACHE_VERSION
  ) {
    const cachedValue = cachedEntry.value as {
      historyUsed?: { messagesAnalyzed?: number; messagePages?: number };
    };
    console.info(
      `[deep-analysis] fan ${fanId} cached: ${cachedValue.historyUsed?.messagesAnalyzed || 0} msgs, pages=${cachedValue.historyUsed?.messagePages || 0}`,
    );

    return Response.json({
      ...(cachedEntry.value as object),
      cached: true,
    });
  }

  const [messagesResult, transactionsResult] = await Promise.all([
    fetchAllMessages({ accountId, apiKey, fanId }),
    fetchAllTransactions({ apiKey, fanId, platform, platformAccountId }),
  ]);
  const dateRange = getDateRange(messagesResult.messages);
  const ppvSentCount = messagesResult.messages.filter(
    (message) => (message.price || 0) > 0 || message.can_purchase,
  ).length;
  const value = {
    cached: false,
    contextVersion: FULL_CONTEXT_CACHE_VERSION,
    accountId,
    fanId,
    historyUsed: {
      status:
        messagesResult.complete && transactionsResult.complete
          ? "completo"
          : "incompleto",
      messagesAnalyzed: messagesResult.messages.length,
      firstMessageAt: dateRange.firstMessageAt,
      lastMessageAt: dateRange.lastMessageAt,
      messagePages: messagesResult.pageCount,
      transactionsIncluded: transactionsResult.transactions.length,
      transactionPages: transactionsResult.pageCount,
      historicalSpendIncluded: transactionsResult.complete,
      historicalBlocksSummarized: 0,
      incompleteReason: [
        messagesResult.error
          ? `Mensajes: ${messagesResult.error}`
          : "",
        transactionsResult.error
          ? `Transacciones: ${transactionsResult.error}`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
    paginationDiagnostics: {
      messageEndpoint:
        "/api/v0/accounts/{account_id}/chats/{fan_id}/messages",
      detectedOlderMessagesParam: "message_id",
      docsPagination:
        "Swagger indica limit, message_id, order y has_more para paginar mensajes.",
      pages: messagesResult.diagnostics,
    },
    messages: messagesResult.messages,
    transactions: transactionsResult.transactions,
    purchaseMetrics: {
      ...transactionsResult.metrics,
      ppvSentCount,
    },
  };

  fullContextCache.entries.set(cacheKey, {
    accountId,
    fanId,
    platformAccountId,
    updatedAt: Date.now(),
    value,
  });

  return Response.json(value);
}
