"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Account = {
  id: string;
  name: string;
  platform: string;
  platform_account_id: string;
  username: string;
};

type Message = {
  id: number;
  text: string;
  is_sent_by_me: boolean;
  created_at: string;
};

type FanSummary = {
  fanId: string;
  label: string;
  name: string | null;
  username: string | null;
  lastMessage: string;
  lastMessageDate: string | null;
  totalSpent: number | null;
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
  purchasesAfterWelcome?: number | null;
};

type RawMessage = Record<string, unknown>;

type SpendingDetails = {
  totalSpent: number;
  purchaseCount: number;
  ppvPurchaseCount: number;
  tipCount: number;
  tipTotal: number;
  lastPurchase: {
    amount?: number | null;
    date?: string | null;
    type?: string | null;
  } | null;
  welcomePPVPurchased: boolean;
  source: "transactions" | "webhook" | "no disponible";
};

type CachedSpending = SpendingDetails & {
  updatedAt: number;
};

type SpendingError = {
  message: string;
  status: number | null;
  body: unknown;
};

type SpendingStatus = "loading" | "error";

type SpendingQueueItem = {
  fanId: string;
  force: boolean;
};

type AnalysisResult = {
  buyerType: string;
  fanClassification?: string;
  historicalValue?: string;
  purchaseIntentScore: number;
  purchaseIntentLabel: string;
  repurchaseProbability: number | null;
  repurchaseProbabilityLabel: string | null;
  repurchaseInsufficientDataReason: string;
  mainMotivation: string;
  mainObjection: string;
  whatThisFanAlreadyDid: string;
  purchaseBreakdown: {
    initialPurchase: string;
    welcomePPV: string;
    ppvPurchased: string;
    tip: string;
    subscription: string;
    totalSpent: string;
    purchaseCount: string;
    lastPurchase: string;
    purchasesAfterWelcome: string;
  };
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
  historyUsed?: {
    status: string;
    messagesAnalyzed: number;
    firstMessageAt: string | null;
    lastMessageAt: string | null;
    transactionsIncluded: number;
    historicalSpendIncluded: boolean;
    historicalBlocksSummarized: number;
    messagePages?: number;
    incompleteReason: string;
    cached: boolean;
  };
  requestId?: string;
  warnings?: string[];
};

type FullContext = {
  cached?: boolean;
  historyUsed?: {
    status: string;
    messagesAnalyzed: number;
    firstMessageAt: string | null;
    lastMessageAt: string | null;
    messagePages?: number;
    transactionsIncluded: number;
    historicalSpendIncluded: boolean;
    incompleteReason?: string;
  };
  messages?: Array<{
    id: number;
    text: string;
    is_sent_by_me: boolean;
    created_at: string;
  }>;
  transactions?: unknown[];
  purchaseMetrics?: unknown;
  paginationDiagnostics?: unknown;
};

type FullHistoryState = {
  status: "idle" | "loading" | "complete" | "limited" | "error";
  message: string;
};

const SPENDING_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CONCURRENT_SPENDING_REQUESTS = 2;

function formatDate(value: string | null) {
  if (!value) {
    return "Fecha no disponible";
  }

  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function readFanSummaries() {
  if (typeof window === "undefined") {
    return {};
  }

  const savedSummaries = localStorage.getItem("onlymonster_fan_summaries");

  return savedSummaries
    ? (JSON.parse(savedSummaries) as Record<string, FanSummary>)
    : {};
}

function readCachedFanIds(accountId?: string) {
  if (typeof window === "undefined" || !accountId) {
    return [];
  }

  const savedFanIds = localStorage.getItem(`onlymonster_fan_ids_${accountId}`);

  return savedFanIds ? (JSON.parse(savedFanIds) as string[]) : [];
}

function readCachedMessages(fanId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const savedMessages = localStorage.getItem(`onlymonster_messages_${fanId}`);

  return savedMessages ? (JSON.parse(savedMessages) as Message[]) : null;
}

function readCachedDebugMessages(fanId: string) {
  if (typeof window === "undefined") {
    return [];
  }

  const savedMessages = localStorage.getItem(
    `onlymonster_debug_messages_${fanId}`,
  );

  return savedMessages ? (JSON.parse(savedMessages) as RawMessage[]) : [];
}

function readFanAliases() {
  if (typeof window === "undefined") {
    return {};
  }

  const savedAliases = localStorage.getItem("onlymonster_fan_aliases");

  return savedAliases ? (JSON.parse(savedAliases) as Record<string, string>) : {};
}

function buildFanLabel(
  fanId: string,
  name?: string | null,
  username?: string | null,
) {
  if (name) {
    return name;
  }

  if (username) {
    return `@${username}`;
  }

  return `Fan #${fanId}`;
}

function hasRealFanName(summary?: FanSummary) {
  return Boolean(summary?.name || summary?.username);
}

function getFanDisplayLabel(
  fanId: string,
  summary: FanSummary | undefined,
  alias?: string,
) {
  if (summary?.name || summary?.username) {
    return buildFanLabel(fanId, summary.name, summary.username);
  }

  if (alias) {
    return alias;
  }

  return summary?.label || `Fan #${fanId}`;
}

function buildFanAliasKey(accountId: string | undefined, fanId: string) {
  return accountId ? `${accountId}:${fanId}` : fanId;
}

function buildSpendingCacheKey(accountId: string | undefined, fanId: string) {
  return accountId ? `${accountId}:${fanId}` : fanId;
}

function buildFullHistoryKey(accountId: string | undefined, fanId: string) {
  return accountId ? `${accountId}:${fanId}` : fanId;
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

function cleanMessagePreview(value: unknown) {
  if (typeof value !== "string") {
    return "[media]";
  }

  const cleanedValue = decodeHtmlEntities(
    value
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<\/p\s*>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );

  return cleanedValue || "[sin texto]";
}

function readCachedSpending(accountId: string | undefined, fanId: string) {
  if (typeof window === "undefined" || !accountId) {
    return null;
  }

  const savedSpending = localStorage.getItem(
    `onlymonster_spending_${accountId}_${fanId}`,
  );

  if (!savedSpending) {
    return null;
  }

  const spending = JSON.parse(savedSpending) as CachedSpending;

  return Date.now() - spending.updatedAt < SPENDING_CACHE_TTL_MS
    ? spending
    : null;
}

function writeCachedSpending(
  accountId: string | undefined,
  fanId: string,
  spending: CachedSpending,
) {
  if (typeof window === "undefined" || !accountId) {
    return;
  }

  localStorage.setItem(
    `onlymonster_spending_${accountId}_${fanId}`,
    JSON.stringify(spending),
  );
}

function scoreWithLabel(score: number, label: string) {
  return `${Math.round(score)}% · ${label}`;
}

export default function ChatsPage() {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fanListRef = useRef<HTMLDivElement | null>(null);
  const pendingInitialScrollRef = useRef(false);
  const spendingQueueRef = useRef<SpendingQueueItem[]>([]);
  const spendingInFlightRef = useRef<Set<string>>(new Set());
  const spendingActiveCountRef = useRef(0);
  const spendingDelayUntilRef = useRef(0);
  const seenWebhookIdsRef = useRef<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [fanIds, setFanIds] = useState<string[]>([]);
  const [fanSummaries, setFanSummaries] = useState<Record<string, FanSummary>>(
    {},
  );
  const [selectedFanId, setSelectedFanId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [, setDebugRawMessages] = useState<RawMessage[]>([]);
  const [fanAliases, setFanAliases] = useState<Record<string, string>>({});
  const [editingAliasFanId, setEditingAliasFanId] = useState("");
  const [aliasDraft, setAliasDraft] = useState("");
  const [spendingDetails, setSpendingDetails] =
    useState<SpendingDetails | null>(null);
  const [spendingError, setSpendingError] = useState<SpendingError | null>(null);
  const [showSpendingPanel, setShowSpendingPanel] = useState(false);
  const [spendingCache, setSpendingCache] = useState<
    Record<string, CachedSpending>
  >({});
  const [spendingStatus, setSpendingStatus] = useState<
    Record<string, SpendingStatus>
  >({});
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(
    null,
  );
  const [analysisError, setAnalysisError] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState("");
  const [historyDiagnostic, setHistoryDiagnostic] = useState<unknown>(null);
  const [showHistoryDiagnostic, setShowHistoryDiagnostic] = useState(false);
  const [analyzingFanId, setAnalyzingFanId] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [fanProfilePreview, setFanProfilePreview] = useState<unknown>(null);
  const [fullContexts, setFullContexts] = useState<Record<string, FullContext>>(
    {},
  );
  const [fullHistoryStates, setFullHistoryStates] = useState<
    Record<string, FullHistoryState>
  >({});
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [error, setError] = useState("");
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [loadingFanId, setLoadingFanId] = useState("");
  const [loadingSpendingFanId, setLoadingSpendingFanId] = useState("");
  const [isClickBlocked, setIsClickBlocked] = useState(false);
  const [retrySecondsRemaining, setRetrySecondsRemaining] = useState(0);

  const scrollToLastMessage = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      sentinelRef.current?.scrollIntoView({
        behavior,
        block: "end",
      });
    },
    [],
  );

  const queueInitialScrollToLastMessage = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!pendingInitialScrollRef.current) {
          return;
        }

        sentinelRef.current?.scrollIntoView({
          behavior: "auto",
          block: "end",
        });
        pendingInitialScrollRef.current = false;
      });
    });
  }, []);

  const applySpendingData = useCallback(
    (fanId: string, data: Record<string, unknown>) => {
      const cacheKey = buildSpendingCacheKey(account?.id, fanId);
      const nextSpending: CachedSpending = {
        totalSpent:
          typeof data.totalSpent === "number" ? data.totalSpent : 0,
        purchaseCount:
          typeof data.purchaseCount === "number" ? data.purchaseCount : 0,
        ppvPurchaseCount:
          typeof data.ppvPurchaseCount === "number"
            ? data.ppvPurchaseCount
            : 0,
        tipCount: typeof data.tipCount === "number" ? data.tipCount : 0,
        tipTotal: typeof data.tipTotal === "number" ? data.tipTotal : 0,
        lastPurchase:
          typeof data.lastPurchase === "object" && data.lastPurchase !== null
            ? (data.lastPurchase as CachedSpending["lastPurchase"])
            : null,
        welcomePPVPurchased:
          typeof data.welcomePPVPurchased === "boolean"
            ? data.welcomePPVPurchased
            : false,
        source:
          data.source === "transactions" ||
          data.source === "webhook" ||
          data.source === "no disponible"
            ? data.source
            : "transactions",
        updatedAt: Date.now(),
      };

      writeCachedSpending(account?.id, fanId, nextSpending);
      setSpendingCache((currentCache) => ({
        ...currentCache,
        [cacheKey]: nextSpending,
      }));
      setSpendingStatus((currentStatus) => {
        const updatedStatus = { ...currentStatus };
        delete updatedStatus[cacheKey];
        return updatedStatus;
      });
      setFanSummaries((currentSummaries) => {
        const currentSummary = currentSummaries[fanId] || {
          fanId,
          label: buildFanLabel(fanId),
          name: null,
          username: null,
          lastMessage: "Sin mensaje",
          lastMessageDate: null,
          totalSpent: null,
          initialPurchase: null,
          welcomePPVPurchased: null,
          ppvPurchased: null,
          tipReceived: null,
          subscriptionActive: null,
          purchaseCount: null,
          lastPurchase: null,
          purchasesAfterWelcome: null,
        };
        const fan =
          typeof data.fan === "object" && data.fan !== null
            ? (data.fan as { name?: string; username?: string })
            : null;
        const updatedSummaries = {
          ...currentSummaries,
          [fanId]: {
            ...currentSummary,
            label:
              fan?.name || fan?.username
                ? buildFanLabel(fanId, fan.name, fan.username)
                : currentSummary.label,
            name: fan?.name || currentSummary.name,
            username: fan?.username || currentSummary.username,
            totalSpent: nextSpending.totalSpent,
            initialPurchase:
              typeof data.initialPurchase === "boolean"
                ? data.initialPurchase
                : currentSummary.initialPurchase ?? null,
            welcomePPVPurchased: nextSpending.welcomePPVPurchased,
            ppvPurchased:
              typeof data.ppvPurchased === "boolean"
                ? data.ppvPurchased
                : currentSummary.ppvPurchased ?? null,
            tipReceived:
              typeof data.tipReceived === "boolean"
                ? data.tipReceived
                : currentSummary.tipReceived ?? null,
            subscriptionActive:
              typeof data.subscriptionActive === "boolean"
                ? data.subscriptionActive
                : currentSummary.subscriptionActive ?? null,
            purchaseCount: nextSpending.purchaseCount,
            lastPurchase: nextSpending.lastPurchase,
            purchasesAfterWelcome:
              typeof data.purchasesAfterWelcome === "number"
                ? data.purchasesAfterWelcome
                : currentSummary.purchasesAfterWelcome ?? null,
          },
        };

        localStorage.setItem(
          "onlymonster_fan_summaries",
          JSON.stringify(updatedSummaries),
        );

        return updatedSummaries;
      });

      return nextSpending;
    },
    [account?.id],
  );

  const fetchSpendingForFan = useCallback(
    async ({
      fanId,
      force = false,
      showPanel = false,
    }: {
      fanId: string;
      force?: boolean;
      showPanel?: boolean;
    }) => {
      if (!apiKey || !account) {
        if (showPanel) {
          setSpendingError({
            message: "No se pudo cargar el gasto",
            status: null,
            body: "Conecta OnlyMonster y selecciona una cuenta antes de cargar gasto.",
          });
        }

        return;
      }

      const cacheKey = buildSpendingCacheKey(account.id, fanId);
      const cachedSpending = readCachedSpending(account.id, fanId);

      if (!force && cachedSpending) {
        setSpendingCache((currentCache) => ({
          ...currentCache,
          [cacheKey]: cachedSpending,
        }));
        setFanSummaries((currentSummaries) => ({
          ...currentSummaries,
          [fanId]: {
            ...(currentSummaries[fanId] || {
              fanId,
              label: buildFanLabel(fanId),
              name: null,
              username: null,
              lastMessage: "Sin mensaje",
              lastMessageDate: null,
              totalSpent: null,
            }),
            totalSpent: cachedSpending.totalSpent,
          },
        }));

        if (showPanel) {
          setSpendingDetails(cachedSpending);
        }

        return;
      }

      if (spendingInFlightRef.current.has(cacheKey)) {
        return;
      }

      spendingInFlightRef.current.add(cacheKey);
      setSpendingStatus((currentStatus) => ({
        ...currentStatus,
        [cacheKey]: "loading",
      }));

      if (showPanel) {
        setLoadingSpendingFanId(fanId);
      }

      try {
        const params = new URLSearchParams({
          fanId,
          platform: account.platform || "onlyfans",
          platformAccountId: account.platform_account_id,
        });
        const response = await fetch(`/api/onlymonster/chats/spending?${params}`, {
          headers: {
            "x-om-auth-token": apiKey,
          },
        });
        const data = await response.json();

        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter =
              typeof data.retryAfter === "number" ? data.retryAfter : 60;
            spendingDelayUntilRef.current = Date.now() + retryAfter * 1000;
            handleRateLimit(retryAfter);
          }

          setSpendingStatus((currentStatus) => ({
            ...currentStatus,
            [cacheKey]: "error",
          }));

          if (showPanel) {
            setSpendingError({
              message: "No se pudo cargar el gasto",
              status: data.technicalStatus || response.status,
              body: data.technicalBody || data,
            });
          }

          return;
        }

        const nextSpending = applySpendingData(fanId, data);

        if (showPanel) {
          setSpendingDetails(nextSpending);
        }
      } catch (spendingRequestError) {
        setSpendingStatus((currentStatus) => ({
          ...currentStatus,
          [cacheKey]: "error",
        }));

        if (showPanel) {
          setSpendingError({
            message: "No se pudo cargar el gasto",
            status: null,
            body:
              spendingRequestError instanceof Error
                ? spendingRequestError.message
                : "Error desconocido al cargar gasto.",
          });
        }
      } finally {
        spendingInFlightRef.current.delete(cacheKey);

        if (showPanel) {
          setLoadingSpendingFanId("");
        }
      }
    },
    [account, apiKey, applySpendingData],
  );

  const processSpendingQueue = useCallback(() => {
    if (!account || !apiKey) {
      return;
    }

    if (Date.now() < spendingDelayUntilRef.current) {
      window.setTimeout(processSpendingQueue, 1000);
      return;
    }

    while (
      spendingActiveCountRef.current < MAX_CONCURRENT_SPENDING_REQUESTS &&
      spendingQueueRef.current.length > 0
    ) {
      const nextItem = spendingQueueRef.current.shift();

      if (!nextItem) {
        return;
      }

      spendingActiveCountRef.current += 1;
      fetchSpendingForFan(nextItem)
        .finally(() => {
          spendingActiveCountRef.current = Math.max(
            0,
            spendingActiveCountRef.current - 1,
          );
          processSpendingQueue();
        });
    }
  }, [account, apiKey, fetchSpendingForFan]);

  const enqueueSpending = useCallback(
    (
      nextFanIds: string[],
      options: { force?: boolean; priority?: boolean } = {},
    ) => {
      if (!account) {
        return;
      }

      const nextItems = nextFanIds
        .filter((fanId) => {
          const cacheKey = buildSpendingCacheKey(account.id, fanId);
          const hasQueuedItem = spendingQueueRef.current.some(
            (item) =>
              buildSpendingCacheKey(account.id, item.fanId) === cacheKey,
          );

          return (
            !spendingInFlightRef.current.has(cacheKey) &&
            !hasQueuedItem &&
            (options.force || !readCachedSpending(account.id, fanId))
          );
        })
        .map((fanId) => ({ fanId, force: Boolean(options.force) }));

      if (options.priority) {
        spendingQueueRef.current = [
          ...nextItems,
          ...spendingQueueRef.current,
        ];
      } else {
        spendingQueueRef.current = [
          ...spendingQueueRef.current,
          ...nextItems,
        ];
      }

      processSpendingQueue();
    },
    [account, processSpendingQueue],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMounted(true);

      const savedApiKey = localStorage.getItem("onlymonster_api_key");
      const savedAccount = localStorage.getItem("onlymonster_selected_account");

      if (savedApiKey) {
        setApiKey(savedApiKey);
      }

      if (savedAccount) {
        const nextAccount = JSON.parse(savedAccount) as Account;
        setAccount(nextAccount);
        setFanIds(readCachedFanIds(nextAccount.id));
      }

      setFanSummaries(readFanSummaries());
      setFanAliases(readFanAliases());
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!retrySecondsRemaining) {
      return;
    }

    const timer = window.setInterval(() => {
      setRetrySecondsRemaining((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [retrySecondsRemaining]);

  useEffect(() => {
    if (
      !pendingInitialScrollRef.current ||
      isLoadingMessages ||
      !selectedFanId ||
      messages.length === 0
    ) {
      return;
    }

    queueInitialScrollToLastMessage();
  }, [
    isLoadingMessages,
    messages.length,
    queueInitialScrollToLastMessage,
    selectedFanId,
  ]);

  useEffect(() => {
    if (!showSpendingPanel) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowSpendingPanel(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showSpendingPanel]);

  useEffect(() => {
    if (!editingAliasFanId) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setEditingAliasFanId("");
        setAliasDraft("");
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editingAliasFanId]);

  useEffect(() => {
    if (!account || fanIds.length === 0) {
      return;
    }

    const accountId = account.id;
    const timer = window.setTimeout(() => {
      const cachedEntries = fanIds.reduce<Record<string, CachedSpending>>(
        (entries, fanId) => {
          const cachedSpending = readCachedSpending(accountId, fanId);

          if (cachedSpending) {
            entries[buildSpendingCacheKey(accountId, fanId)] = cachedSpending;
          }

          return entries;
        },
        {},
      );

      if (Object.keys(cachedEntries).length > 0) {
        setSpendingCache((currentCache) => ({
          ...currentCache,
          ...cachedEntries,
        }));
        setFanSummaries((currentSummaries) => {
          const updatedSummaries = { ...currentSummaries };

          for (const fanId of fanIds) {
            const cachedSpending =
              cachedEntries[buildSpendingCacheKey(accountId, fanId)];

            if (!cachedSpending) {
              continue;
            }

            updatedSummaries[fanId] = {
              ...(updatedSummaries[fanId] || {
                fanId,
                label: buildFanLabel(fanId),
                name: null,
                username: null,
                lastMessage: "Sin mensaje",
                lastMessageDate: null,
              }),
              totalSpent: cachedSpending.totalSpent,
            };
          }

          return updatedSummaries;
        });
      }

      enqueueSpending(fanIds.slice(0, 20));
    }, 0);

    return () => window.clearTimeout(timer);
  }, [account, enqueueSpending, fanIds]);

  useEffect(() => {
    if (!fanListRef.current || !account || fanIds.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleFanIds = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) =>
            entry.target instanceof HTMLElement
              ? entry.target.dataset.fanId
              : null,
          )
          .filter((fanId): fanId is string => Boolean(fanId));

        if (visibleFanIds.length > 0) {
          enqueueSpending(visibleFanIds);
        }
      },
      {
        root: fanListRef.current,
        rootMargin: "160px 0px",
        threshold: 0.1,
      },
    );

    const fanCards = fanListRef.current.querySelectorAll("[data-fan-id]");
    fanCards.forEach((fanCard) => observer.observe(fanCard));

    return () => observer.disconnect();
  }, [account, enqueueSpending, fanIds]);

  useEffect(() => {
    if (!selectedFanId || !account) {
      return;
    }

    enqueueSpending([selectedFanId], { priority: true });
  }, [account, enqueueSpending, selectedFanId]);

  useEffect(() => {
    if (!account) {
      return;
    }

    const accountId = account.id;

    async function refreshWebhookInvalidations() {
      const response = await fetch("/api/webhooks/onlymonster/events");
      const data = await response.json();
      const events = Array.isArray(data.events) ? data.events : [];
      const purchaseEvents = new Set([
        "fans.ppv.purchased",
        "fans.tip.received",
      ]);
      const changedFanIds: string[] = [];

      for (const event of events) {
        if (
          typeof event.id !== "string" ||
          seenWebhookIdsRef.current.has(event.id)
        ) {
          continue;
        }

        seenWebhookIdsRef.current.add(event.id);

        if (
          purchaseEvents.has(event.type) &&
          event.account_id === accountId &&
          typeof event.fan_id === "string"
        ) {
          const historyKey = buildFullHistoryKey(accountId, event.fan_id);
          localStorage.removeItem(
            `onlymonster_spending_${accountId}_${event.fan_id}`,
          );
          changedFanIds.push(event.fan_id);
          setFullContexts((currentContexts) => {
            const updatedContexts = { ...currentContexts };
            delete updatedContexts[historyKey];
            return updatedContexts;
          });
        }

        if (
          event.type === "chat.message" &&
          event.account_id === accountId &&
          typeof event.fan_id === "string"
        ) {
          const historyKey = buildFullHistoryKey(accountId, event.fan_id);
          const payload =
            typeof event.payload === "object" && event.payload !== null
              ? (event.payload as Record<string, unknown>)
              : {};
          const nextLastMessage = cleanMessagePreview(payload.text);
          const nextLastMessageDate =
            typeof payload.created_at === "string"
              ? payload.created_at
              : new Date().toISOString();

          setFanSummaries((currentSummaries) => {
            const currentSummary = currentSummaries[event.fan_id] || {
              fanId: event.fan_id,
              label: buildFanLabel(event.fan_id),
              name: null,
              username: null,
              lastMessage: "Sin mensaje",
              lastMessageDate: null,
              totalSpent: null,
            };
            const updatedSummaries = {
              ...currentSummaries,
              [event.fan_id]: {
                ...currentSummary,
                lastMessage: nextLastMessage,
                lastMessageDate: nextLastMessageDate,
              },
            };

            localStorage.setItem(
              "onlymonster_fan_summaries",
              JSON.stringify(updatedSummaries),
            );

            return updatedSummaries;
          });
          setFanIds((currentFanIds) => {
            const updatedFanIds = [
              event.fan_id,
              ...currentFanIds.filter((fanId) => fanId !== event.fan_id),
            ].map(String);

            localStorage.setItem(
              `onlymonster_fan_ids_${accountId}`,
              JSON.stringify(updatedFanIds),
            );

            return updatedFanIds;
          });
          setFullContexts((currentContexts) => {
            const updatedContexts = { ...currentContexts };
            delete updatedContexts[historyKey];
            return updatedContexts;
          });
          setFullHistoryStates((currentStates) => ({
            ...currentStates,
            [historyKey]: {
              status: "idle",
              message: "",
            },
          }));
        }
      }

      if (changedFanIds.length > 0) {
        enqueueSpending(changedFanIds, { force: true, priority: true });
      }
    }

    refreshWebhookInvalidations().catch(() => undefined);
    const timer = window.setInterval(() => {
      refreshWebhookInvalidations().catch(() => undefined);
    }, 30000);

    return () => window.clearInterval(timer);
  }, [account, enqueueSpending]);

  function handleRateLimit(retryAfter?: number) {
    setRetrySecondsRemaining(retryAfter || 60);
  }

  async function loadConversations() {
    setError("");

    if (!apiKey || !account) {
      setError("Conecta OnlyMonster y selecciona una cuenta antes de cargar conversaciones.");
      return;
    }

    if (isLoadingConversations) {
      return;
    }

    setIsLoadingConversations(true);

    try {
      const params = new URLSearchParams({
        accountId: account.id,
      });
      const response = await fetch(`/api/onlymonster/chats?${params}`, {
        headers: {
          "x-om-auth-token": apiKey,
        },
      });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          handleRateLimit(data.retryAfter);
        }

        throw new Error(data.error || "No se pudieron cargar conversaciones.");
      }

      const nextFanIds = data.fanIds || [];
      const fanProfiles = data.fanProfiles || {};

      setFanIds(nextFanIds);
      localStorage.setItem(
        `onlymonster_fan_ids_${account.id}`,
        JSON.stringify(nextFanIds),
      );
      setFanSummaries((currentSummaries) => {
        const updatedSummaries = { ...currentSummaries };

        for (const fanId of nextFanIds) {
          const profile = fanProfiles[fanId];

          if (!profile?.name && !profile?.username) {
            continue;
          }

          const currentSummary = updatedSummaries[fanId];

          updatedSummaries[fanId] = {
            fanId,
            label: buildFanLabel(fanId, profile.name, profile.username),
            name: profile.name || null,
            username: profile.username || null,
            lastMessage: currentSummary?.lastMessage || "Sin mensaje",
            lastMessageDate: currentSummary?.lastMessageDate || null,
            totalSpent: currentSummary?.totalSpent ?? null,
            initialPurchase: currentSummary?.initialPurchase ?? null,
            welcomePPVPurchased: currentSummary?.welcomePPVPurchased ?? null,
            ppvPurchased: currentSummary?.ppvPurchased ?? null,
            tipReceived: currentSummary?.tipReceived ?? null,
            subscriptionActive: currentSummary?.subscriptionActive ?? null,
            purchaseCount: currentSummary?.purchaseCount ?? null,
            lastPurchase: currentSummary?.lastPurchase ?? null,
            purchasesAfterWelcome: currentSummary?.purchasesAfterWelcome ?? null,
          };
        }

        localStorage.setItem(
          "onlymonster_fan_summaries",
          JSON.stringify(updatedSummaries),
        );

        return updatedSummaries;
      });
      enqueueSpending(nextFanIds.slice(0, 20), {
        force: true,
        priority: true,
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Error desconocido al cargar conversaciones.",
      );
    } finally {
      setIsLoadingConversations(false);
    }
  }

  async function openConversation(fanId: string) {
    if (isClickBlocked || isLoadingMessages) {
      return;
    }

    setError("");
    setSelectedFanId(fanId);
    pendingInitialScrollRef.current = true;
    const cachedMessages = readCachedMessages(fanId) || [];
    setMessages(cachedMessages);
    setDebugRawMessages(readCachedDebugMessages(fanId));
    setSpendingDetails(null);
    setSpendingError(null);
    setShowSpendingPanel(false);
    setAnalysisResult(null);
    setAnalysisError("");
    setShowAnalysisPanel(false);
    setIsLoadingMessages(true);
    setLoadingFanId(fanId);
    setIsClickBlocked(true);
    window.setTimeout(() => setIsClickBlocked(false), 1000);

    if (!apiKey || !account) {
      setError("Conecta OnlyMonster y selecciona una cuenta antes de abrir mensajes.");
      pendingInitialScrollRef.current = false;
      setIsLoadingMessages(false);
      setLoadingFanId("");
      return;
    }

    try {
      const params = new URLSearchParams({
        accountId: account.id,
        platform: account.platform || "onlyfans",
        platformAccountId: account.platform_account_id,
        chatId: fanId,
      });
      const response = await fetch(`/api/onlymonster/chats/messages?${params}`, {
        headers: {
          "x-om-auth-token": apiKey,
        },
      });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          handleRateLimit(data.retryAfter);
        }

        throw new Error(data.error || "No se pudieron cargar mensajes.");
      }

      const nextMessages = data.messages || [];
      setMessages(nextMessages);
      if (nextMessages.length === 0) {
        pendingInitialScrollRef.current = false;
      }
      setDebugRawMessages(data.debugRawMessages || []);
      localStorage.setItem(
        `onlymonster_messages_${fanId}`,
        JSON.stringify(nextMessages),
      );
      localStorage.setItem(
        `onlymonster_debug_messages_${fanId}`,
        JSON.stringify(data.debugRawMessages || []),
      );

      const lastMessage = nextMessages[nextMessages.length - 1];
      const nextSummary: FanSummary = {
        fanId,
        label: buildFanLabel(
          fanId,
          data.fan?.name,
          data.fan?.username,
        ),
        name: data.fan?.name || null,
        username: data.fan?.username || null,
        lastMessage: lastMessage
          ? cleanMessagePreview(lastMessage.text)
          : "Sin mensaje",
        lastMessageDate: lastMessage?.created_at || null,
        totalSpent:
          typeof data.totalSpent === "number" ? data.totalSpent : null,
      };

      setFanSummaries((currentSummaries) => {
        const updatedSummaries = {
          ...currentSummaries,
          [fanId]: nextSummary,
        };

        localStorage.setItem(
          "onlymonster_fan_summaries",
          JSON.stringify(updatedSummaries),
        );

        return updatedSummaries;
      });
    } catch (loadError) {
      pendingInitialScrollRef.current = false;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Error desconocido al cargar mensajes.",
      );
    } finally {
      setIsLoadingMessages(false);
      setLoadingFanId("");
    }
  }

  async function loadSpending(fanId: string) {
    if (loadingSpendingFanId || !fanId) {
      return;
    }

    setError("");
    setSpendingDetails(null);
    setSpendingError(null);
    setShowSpendingPanel(true);
    await fetchSpendingForFan({ fanId, force: true, showPanel: true });
  }

  function startEditingAlias(fanId: string) {
    setEditingAliasFanId(fanId);
    setAliasDraft(fanAliases[buildFanAliasKey(account?.id, fanId)] || "");
  }

  function saveFanAlias(fanId: string) {
    const nextAlias = aliasDraft.trim();
    const aliasKey = buildFanAliasKey(account?.id, fanId);

    setFanAliases((currentAliases) => {
      const updatedAliases = { ...currentAliases };

      if (nextAlias) {
        updatedAliases[aliasKey] = nextAlias;
      } else {
        delete updatedAliases[aliasKey];
      }

      localStorage.setItem(
        "onlymonster_fan_aliases",
        JSON.stringify(updatedAliases),
      );

      return updatedAliases;
    });
    setEditingAliasFanId("");
    setAliasDraft("");
  }

  function deleteFanAlias(fanId: string) {
    const aliasKey = buildFanAliasKey(account?.id, fanId);

    setFanAliases((currentAliases) => {
      const updatedAliases = { ...currentAliases };
      delete updatedAliases[aliasKey];

      localStorage.setItem(
        "onlymonster_fan_aliases",
        JSON.stringify(updatedAliases),
      );

      return updatedAliases;
    });
    setEditingAliasFanId("");
    setAliasDraft("");
  }

  function closeAliasEditor() {
    setEditingAliasFanId("");
    setAliasDraft("");
  }

  async function loadFullHistoryForFan({
    fanId,
    showInChat,
  }: {
    fanId: string;
    showInChat: boolean;
  }) {
    if (!account || !apiKey) {
      throw new Error("Conecta OnlyMonster antes de cargar el historial.");
    }

    const historyKey = buildFullHistoryKey(account.id, fanId);
    const cachedContext = fullContexts[historyKey];

    if (cachedContext) {
      return cachedContext;
    }

    setFullHistoryStates((currentStates) => ({
      ...currentStates,
      [historyKey]: {
        status: "loading",
        message: "Cargando historial completo... página 1",
      },
    }));

    const params = new URLSearchParams({
      accountId: account.id,
      fanId,
      platform: account.platform || "onlyfans",
      platformAccountId: account.platform_account_id,
    });
    const response = await fetch(`/api/onlymonster/chats/full-context?${params}`, {
      headers: {
        "x-om-auth-token": apiKey,
      },
    });
    const fullContext = (await response.json()) as FullContext & {
      error?: string;
    };

    if (!response.ok) {
      setFullHistoryStates((currentStates) => ({
        ...currentStates,
        [historyKey]: {
          status: "error",
          message: fullContext.error || "No se pudo cargar el historial completo.",
        },
      }));
      throw new Error(
        fullContext.error || "No se pudo cargar el historial completo.",
      );
    }

    setFullContexts((currentContexts) => ({
      ...currentContexts,
      [historyKey]: fullContext,
    }));
    setHistoryDiagnostic(fullContext.paginationDiagnostics || null);

    const fullMessages = (fullContext.messages || []).map((message) => ({
      id: message.id,
      text: message.text || "[sin texto]",
      is_sent_by_me: message.is_sent_by_me,
      created_at: message.created_at,
    }));

    if (showInChat) {
      setMessages(fullMessages);
      localStorage.setItem(
        `onlymonster_messages_${fanId}`,
        JSON.stringify(fullMessages),
      );
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => scrollToLastMessage("auto"));
      });
    }

    if (fullMessages.length > 0) {
      const lastMessage = fullMessages[fullMessages.length - 1];
      setFanSummaries((currentSummaries) => {
        const currentSummary = currentSummaries[fanId] || {
          fanId,
          label: buildFanLabel(fanId),
          name: null,
          username: null,
          lastMessage: "Sin mensaje",
          lastMessageDate: null,
          totalSpent: null,
        };
        const updatedSummaries = {
          ...currentSummaries,
          [fanId]: {
            ...currentSummary,
            lastMessage: cleanMessagePreview(lastMessage.text),
            lastMessageDate: lastMessage.created_at,
          },
        };

        localStorage.setItem(
          "onlymonster_fan_summaries",
          JSON.stringify(updatedSummaries),
        );

        return updatedSummaries;
      });
    }

    const status =
      fullContext.historyUsed?.status === "completo" ? "complete" : "limited";
    const message =
      status === "complete"
        ? `Historial completo cargado: ${fullContext.historyUsed?.messagesAnalyzed || fullMessages.length} mensajes`
        : `Historial limitado: ${fullContext.historyUsed?.messagesAnalyzed || fullMessages.length} mensajes`;

    setFullHistoryStates((currentStates) => ({
      ...currentStates,
      [historyKey]: {
        status,
        message,
      },
    }));

    return fullContext;
  }

  async function analyzeConversation() {
    const formattedConversation = messages
      .map((message) => {
        const speaker = message.is_sent_by_me ? "CREADORA" : "FAN";
        return `[${speaker}]: ${message.text || "[sin texto]"}`;
      })
      .join("\n");
    const summary = fanSummaries[selectedFanId];
    const fanMetadata = {
      fanId: selectedFanId,
      totalSpent: summary?.totalSpent ?? spendingDetails?.totalSpent ?? null,
      initialPurchase: summary?.initialPurchase ?? null,
      welcomePPVPurchased:
        summary?.welcomePPVPurchased ??
        spendingDetails?.welcomePPVPurchased ??
        null,
      ppvPurchased: summary?.ppvPurchased ?? null,
      ppvPurchaseCount: spendingDetails?.ppvPurchaseCount ?? null,
      tipReceived: summary?.tipReceived ?? null,
      tipCount: spendingDetails?.tipCount ?? null,
      tipTotal: spendingDetails?.tipTotal ?? null,
      subscriptionActive: summary?.subscriptionActive ?? null,
      purchaseCount: summary?.purchaseCount ?? spendingDetails?.purchaseCount ?? null,
      lastPurchase: summary?.lastPurchase ?? spendingDetails?.lastPurchase ?? null,
      avgPPV: null,
      purchasedContent: null,
      rebillStatus:
        summary?.subscriptionActive === null
          ? null
          : summary?.subscriptionActive
            ? "active"
            : "unknown",
      purchasesAfterWelcome: summary?.purchasesAfterWelcome ?? null,
    };

    setAnalysisError("");
    setAnalysisResult(null);
    setAnalysisProgress("");
    setHistoryDiagnostic(null);
    setShowHistoryDiagnostic(false);
    setFanProfilePreview(null);
    setCopyFeedback("");

    if (!selectedFanId || !account || !apiKey) {
      setAnalysisError("Conecta OnlyMonster y selecciona un fan antes de analizar.");
      return;
    }

    if (!formattedConversation.trim()) {
      setAnalysisError("No hay mensajes para analizar.");
      return;
    }

    setIsAnalyzing(true);
    setAnalyzingFanId(selectedFanId);
    setShowAnalysisPanel(true);

    try {
      const profileParams = new URLSearchParams({
        accountId: account.id,
        fanId: selectedFanId,
      });
      fetch(`/api/analyze/profile?${profileParams}`)
        .then((profileResponse) => profileResponse.json())
        .then((profileData) => {
          if (profileData.profile?.profile) {
            setFanProfilePreview(profileData.profile.profile);
            setAnalysisProgress("Perfil profundo cargado. Actualizando con mensajes recientes...");
          }
        })
        .catch(() => undefined);
      const historyKey = buildFullHistoryKey(account.id, selectedFanId);
      const cachedFullContext = fullContexts[historyKey];

      setAnalysisProgress(
        cachedFullContext
          ? "Usando caché histórica..."
          : "Recopilando historial...",
      );
      const fullContext =
        cachedFullContext ||
        (await loadFullHistoryForFan({
          fanId: selectedFanId,
          showInChat: false,
        }));

      setHistoryDiagnostic(fullContext.paginationDiagnostics || null);
      setAnalysisProgress(
        fullContext.cached || cachedFullContext
          ? "Usando caché histórica... Generando recomendación final..."
          : (fullContext.messages?.length || 0) > 220
            ? `Resumiendo bloques nuevos del historial (${fullContext.historyUsed?.messagesAnalyzed || 0} mensajes)...`
            : `Historial recopilado: ${fullContext.historyUsed?.messagesAnalyzed || 0} mensajes. Generando recomendación final...`,
      );

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationText: formattedConversation,
          sector: "OnlyFans",
          fanMetadata,
          fullContext,
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

      setAnalysisResult(data);
      setShowAnalysisPanel(true);
    } catch (analysisRequestError) {
      setAnalysisError(
        analysisRequestError instanceof Error
          ? analysisRequestError.message
          : "Error desconocido al analizar la conversación.",
      );
    } finally {
      setIsAnalyzing(false);
      setAnalyzingFanId("");
      setAnalysisProgress("");
    }
  }

  async function copySuggestedMessage() {
    if (!analysisResult?.suggestedMessage) {
      return;
    }

    await navigator.clipboard.writeText(analysisResult.suggestedMessage);
    setCopyFeedback("Copiado");
    window.setTimeout(() => setCopyFeedback(""), 1600);
  }

  const analysisPanel = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Análisis IA</h3>
          <p className="text-sm text-zinc-500">
            Recomendaciones para el chat seleccionado
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAnalysisPanel(false)}
          className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 xl:hidden"
        >
          Cerrar
        </button>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
        {!isAnalyzing && !analysisError && !analysisResult ? (
          <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
            Pulsa Analizar conversación para generar recomendaciones.
          </p>
        ) : null}

        {isAnalyzing ? (
          <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
            {analysisProgress || "Analizando historial completo..."}
          </p>
        ) : null}

        {analysisError ? (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
            {analysisError}
          </div>
        ) : null}

        {fanProfilePreview && !analysisResult ? (
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-relaxed text-zinc-200 break-words">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Perfil profundo existente
            </p>
            <pre className="mt-3 max-h-96 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-200">
              {JSON.stringify(fanProfilePreview, null, 2)}
            </pre>
          </div>
        ) : null}

        {analysisResult ? (
          <div className="grid min-w-0 gap-3 text-sm leading-relaxed text-zinc-200 break-words whitespace-normal [&>div]:rounded-2xl [&>div]:border [&>div]:border-white/10 [&>div]:bg-black/20 [&>div]:p-4">
            {analysisResult.warnings?.length ? (
              <div className="border-yellow-300/20 bg-yellow-500/10 text-yellow-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-yellow-200/80">
                  Aviso
                </p>
                {analysisResult.warnings.map((warning) => (
                  <p key={warning} className="mt-2">
                    {warning}
                  </p>
                ))}
                {process.env.NODE_ENV === "development" &&
                analysisResult.requestId ? (
                  <p className="mt-2 text-xs text-yellow-100/70">
                    ID de diagnóstico: {analysisResult.requestId}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Resumen
              </p>
              <p className="mt-2 text-zinc-300">
                {analysisResult.shortReasoning}
              </p>
            </div>
            {analysisResult.historyUsed ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Historial usado
                </p>
                <p className="mt-2 text-zinc-300">
                  {analysisResult.historyUsed.status === "completo"
                    ? "Completo"
                    : analysisResult.historyUsed.status === "incompleto"
                      ? `Historial incompleto: se recuperaron ${analysisResult.historyUsed.messagesAnalyzed} mensajes hasta ${
                          analysisResult.historyUsed.firstMessageAt
                            ? formatDate(
                                analysisResult.historyUsed.firstMessageAt,
                              )
                            : "fecha no disponible"
                        }.`
                      : analysisResult.historyUsed.status}
                </p>
                <p className="mt-1 text-zinc-400">
                  {analysisResult.historyUsed.messagesAnalyzed} mensajes ·{" "}
                  {analysisResult.historyUsed.firstMessageAt
                    ? formatDate(analysisResult.historyUsed.firstMessageAt)
                    : "inicio no disponible"}{" "}
                  →{" "}
                  {analysisResult.historyUsed.lastMessageAt
                    ? formatDate(analysisResult.historyUsed.lastMessageAt)
                    : "fin no disponible"}
                </p>
                <p className="mt-1 text-zinc-400">
                  {analysisResult.historyUsed.messagePages || 0} páginas de
                  mensajes recuperadas
                </p>
                <p className="mt-1 text-zinc-400">
                  {analysisResult.historyUsed.transactionsIncluded}{" "}
                  transacciones ·{" "}
                  {analysisResult.historyUsed.historicalSpendIncluded
                    ? "gasto histórico incluido"
                    : "datos de compra no disponibles"}
                </p>
                {analysisResult.historyUsed.historicalBlocksSummarized > 0 ? (
                  <p className="mt-1 text-zinc-400">
                    {analysisResult.historyUsed.historicalBlocksSummarized}{" "}
                    bloques históricos resumidos
                  </p>
                ) : null}
                {analysisResult.historyUsed.cached ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    Reutilizado desde caché reciente.
                  </p>
                ) : null}
                {analysisResult.historyUsed.incompleteReason ? (
                  <p className="mt-2 text-xs text-yellow-200">
                    {analysisResult.historyUsed.incompleteReason}
                  </p>
                ) : null}
                {historyDiagnostic ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() =>
                        setShowHistoryDiagnostic((isVisible) => !isVisible)
                      }
                      className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-zinc-100 transition hover:bg-white/10"
                    >
                      Ver diagnóstico historial
                    </button>
                    {showHistoryDiagnostic ? (
                      <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 text-xs leading-5 text-zinc-200">
                        {JSON.stringify(historyDiagnostic, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div>
              <p className="text-zinc-500">Tipo de comprador</p>
              <p className="font-semibold">{analysisResult.buyerType}</p>
            </div>
            {analysisResult.fanClassification ? (
              <div>
                <p className="text-zinc-500">Clasificación histórica</p>
                <p className="font-semibold">
                  {analysisResult.fanClassification}
                </p>
              </div>
            ) : null}
            {analysisResult.historicalValue ? (
              <div>
                <p className="text-zinc-500">Valor histórico</p>
                <p>{analysisResult.historicalValue}</p>
              </div>
            ) : null}
            <div>
              <p className="text-zinc-500">Intención</p>
              <p className="font-semibold">
                {scoreWithLabel(
                  analysisResult.purchaseIntentScore,
                  analysisResult.purchaseIntentLabel,
                )}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Recompra</p>
              <p className="font-semibold">
                {analysisResult.repurchaseProbability === null
                  ? `Datos insuficientes: ${analysisResult.repurchaseInsufficientDataReason}`
                  : scoreWithLabel(
                      analysisResult.repurchaseProbability,
                      analysisResult.repurchaseProbabilityLabel || "Media",
                    )}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Confianza</p>
              <p className="font-semibold">
                {scoreWithLabel(
                  analysisResult.confidence,
                  analysisResult.confidenceLabel,
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Compras
              </p>
              <dl className="mt-2 space-y-2">
                <div>
                  <dt className="text-zinc-500">Gasto total</dt>
                  <dd>{analysisResult.purchaseBreakdown.totalSpent}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Compras</dt>
                  <dd>{analysisResult.purchaseBreakdown.purchaseCount}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Última compra</dt>
                  <dd>{analysisResult.purchaseBreakdown.lastPurchase}</dd>
                </div>
              </dl>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Recomendación
              </p>
              <p className="text-zinc-500">Motivación</p>
              <p>{analysisResult.mainMotivation}</p>
            </div>
            <div>
              <p className="text-zinc-500">Objeción</p>
              <p>{analysisResult.mainObjection}</p>
            </div>
            <div>
              <p className="text-zinc-500">Qué hizo ya</p>
              <p>{analysisResult.whatThisFanAlreadyDid}</p>
            </div>
            <div>
              <p className="text-zinc-500">Siguiente acción</p>
              <p>{analysisResult.nextBestAction}</p>
            </div>
            <div>
              <p className="text-zinc-500">Cómo hacerlo</p>
              <p>{analysisResult.howToDoIt}</p>
            </div>
            <div>
              <p className="text-zinc-500">Qué evitar</p>
              <p>{analysisResult.whatToAvoid}</p>
            </div>
            <div>
              <p className="text-zinc-500">Precio PPV sugerido</p>
              <p>${analysisResult.suggestedPPVPrice}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Mensaje sugerido
              </p>
              <p className="mt-2 whitespace-pre-wrap rounded-xl bg-white p-3 font-semibold text-zinc-950">
                {analysisResult.suggestedMessage}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={copySuggestedMessage}
                  className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-zinc-100 transition hover:bg-white/10"
                >
                  Copiar mensaje
                </button>
                <span className="min-w-14 text-xs text-emerald-300">
                  {copyFeedback}
                </span>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Evidencias
              </p>
              <dl className="mt-2 space-y-2">
                <div className="min-w-0">
                  <dt className="text-zinc-500">Señal observada</dt>
                  <dd>{analysisResult.recommendation.observedSignal}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-zinc-500">Interpretación</dt>
                  <dd>{analysisResult.recommendation.interpretation}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-zinc-500">Por qué esa acción</dt>
                  <dd>{analysisResult.recommendation.whyThisAction}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-zinc-500">Razonamiento breve</dt>
                  <dd>{analysisResult.shortReasoning}</dd>
                </div>
              </dl>
            </div>
            <button
              type="button"
              onClick={analyzeConversation}
              disabled={messages.length === 0 || isAnalyzing}
              className="mt-2 rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAnalyzing && analyzingFanId === selectedFanId
                ? "Regenerando..."
                : "Regenerar análisis"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  const spendingPanel = (
    <div
      className="fixed inset-0 z-40 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="spending-panel-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setShowSpendingPanel(false);
        }
      }}
    >
      <div className="ml-auto flex h-full w-full max-w-md flex-col border-l border-white/10 bg-zinc-950 p-5 text-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 id="spending-panel-title" className="text-xl font-semibold">
              Historial de gasto
            </h3>
            <p className="text-sm text-zinc-500">
              {selectedFanId
                ? getFanDisplayLabel(
                    selectedFanId,
                    fanSummaries[selectedFanId],
                    fanAliases[buildFanAliasKey(account?.id, selectedFanId)],
                  )
                : "Fan seleccionado"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSpendingPanel(false)}
            className="rounded-full border border-white/20 px-3 py-1 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
            aria-label="Cerrar historial de gasto"
          >
            X
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-5">
          {loadingSpendingFanId === selectedFanId ? (
            <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300">
              Cargando gasto...
            </p>
          ) : null}

          {spendingDetails ? (
            <dl className="grid gap-4 text-sm text-zinc-300">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-zinc-500">Gasto total</dt>
                <dd className="mt-1 text-lg font-semibold text-white">
                  ${spendingDetails.totalSpent.toFixed(2)}
                </dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-zinc-500">PPVs comprados</dt>
                <dd className="mt-1 font-semibold text-white">
                  {spendingDetails.ppvPurchaseCount}
                </dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-zinc-500">Última compra</dt>
                <dd className="mt-1 font-semibold text-white">
                  {spendingDetails.lastPurchase
                    ? `$${spendingDetails.lastPurchase.amount?.toFixed(2)} · ${
                        mounted
                          ? formatDate(spendingDetails.lastPurchase.date || null)
                          : "Cargando fecha..."
                      }`
                    : "No disponible"}
                </dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-zinc-500">Welcome PPV</dt>
                <dd className="mt-1 font-semibold text-white">
                  {spendingDetails.welcomePPVPurchased
                    ? "Comprado"
                    : "No detectado"}
                </dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-zinc-500">Tips</dt>
                <dd className="mt-1 font-semibold text-white">
                  {spendingDetails.tipCount} · $
                  {spendingDetails.tipTotal.toFixed(2)}
                </dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-zinc-500">Fuente de datos</dt>
                <dd className="mt-1 font-semibold text-white">
                  {spendingDetails.source}
                </dd>
              </div>
            </dl>
          ) : null}

          {spendingError ? (
            <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
              <h3 className="font-semibold">No se pudo cargar el gasto</h3>
              <p className="mt-2">
                Status HTTP: {spendingError.status || "No disponible"}
              </p>
              <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-black/30 p-3 text-xs text-red-50">
                {JSON.stringify(spendingError.body, null, 2)}
              </pre>
            </div>
          ) : null}

          {!loadingSpendingFanId && !spendingDetails && !spendingError ? (
            <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300">
              No hay datos de gasto cargados todavía.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );

  const aliasEditorPanel = editingAliasFanId ? (
    <div
      className="fixed inset-0 z-50 bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alias-editor-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeAliasEditor();
        }
      }}
    >
      <div className="mx-auto mt-24 w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl">
        <h3 id="alias-editor-title" className="text-lg font-semibold">
          Alias para este fan
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          Fan #{editingAliasFanId}
        </p>
        <input
          value={aliasDraft}
          onChange={(event) => setAliasDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              saveFanAlias(editingAliasFanId);
            }
          }}
          placeholder="Ej. Cristian"
          className="mt-4 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-white/40"
          autoFocus
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {fanAliases[buildFanAliasKey(account?.id, editingAliasFanId)] ? (
            <button
              type="button"
              onClick={() => deleteFanAlias(editingAliasFanId)}
              className="mr-auto rounded-full border border-red-400/30 px-4 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/10"
            >
              Eliminar alias
            </button>
          ) : null}
          <button
            type="button"
            onClick={closeAliasEditor}
            className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => saveFanAlias(editingAliasFanId)}
            className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-zinc-200"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const selectedHistoryKey = selectedFanId
    ? buildFullHistoryKey(account?.id, selectedFanId)
    : "";
  const selectedFullHistoryState = selectedHistoryKey
    ? fullHistoryStates[selectedHistoryKey]
    : null;

  return (
    <main className="h-screen overflow-hidden bg-zinc-950 text-white">
      <section className="grid h-screen min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)_360px]">
        <aside className="sticky top-0 flex h-screen min-h-0 flex-col overflow-hidden border-r border-white/10 bg-zinc-950">
          <div className="shrink-0 space-y-4 border-b border-white/10 p-5">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">
                Conversaciones
              </h1>
              <p className="text-sm text-zinc-400">
                {account
                  ? `Cuenta: ${account.name} (@${account.username})`
                  : mounted
                    ? "Conecta una cuenta en OnlyMonster para empezar."
                    : "Cargando cuenta..."}
              </p>
            </div>

            <button
              type="button"
              onClick={loadConversations}
              disabled={isLoadingConversations}
              className="w-full rounded-full bg-white px-5 py-3 font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingConversations
                ? "Actualizando recientes..."
                : "Actualizar recientes"}
            </button>

            {retrySecondsRemaining > 0 ? (
              <div className="rounded-2xl border border-yellow-400/30 bg-yellow-500/10 p-4 text-sm text-yellow-100">
                Espera {retrySecondsRemaining} segundos antes de volver a
                consultar OnlyMonster.
              </div>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
                {error}
              </div>
            ) : null}
          </div>

          <div
            ref={fanListRef}
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
          >
            {fanIds.map((fanId) => {
              const summary = fanSummaries[fanId];
              const alias = fanAliases[buildFanAliasKey(account?.id, fanId)];
              const spendingKey = buildSpendingCacheKey(account?.id, fanId);
              const cachedSpending = spendingCache[spendingKey];
              const currentSpendingStatus = spendingStatus[spendingKey];
              const displayLabel = getFanDisplayLabel(
                fanId,
                summary,
                alias,
              );
              const canEditAlias = !hasRealFanName(summary);
              const showFanId = hasRealFanName(summary) || Boolean(alias);
              const lastMessagePreview = summary?.lastMessage
                ? cleanMessagePreview(summary.lastMessage)
                : "Sin mensaje";
              const spendingLabel =
                currentSpendingStatus === "loading"
                  ? "Calculando..."
                  : currentSpendingStatus === "error"
                    ? "No disponible"
                    : cachedSpending
                      ? `$${cachedSpending.totalSpent.toFixed(2)}`
                      : typeof summary?.totalSpent === "number"
                        ? `$${summary.totalSpent.toFixed(2)}`
                        : "Calculando...";
              const dateLabel =
                summary?.lastMessageDate && mounted
                  ? formatDate(summary.lastMessageDate)
                  : summary?.lastMessageDate
                    ? "Cargando fecha..."
                    : "Sin actividad";

              return (
                <div
                  role="button"
                  tabIndex={0}
                  key={fanId}
                  data-fan-id={fanId}
                  onClick={() => {
                    if (!isClickBlocked && loadingFanId !== fanId) {
                      openConversation(fanId);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (!isClickBlocked && loadingFanId !== fanId) {
                        openConversation(fanId);
                      }
                    }
                  }}
                  aria-disabled={isClickBlocked || loadingFanId === fanId}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${
                    selectedFanId === fanId
                      ? "border-white/50 bg-white/[0.12]"
                      : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">
                        {displayLabel}
                      </h2>
                      {showFanId ? (
                        <p className="truncate text-[11px] text-zinc-500">
                          Fan #{fanId}
                        </p>
                      ) : null}
                    </div>
                    {canEditAlias ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          startEditingAlias(fanId);
                        }}
                        className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-zinc-300 transition hover:bg-white/10"
                      >
                        Editar nombre
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-400">
                    Último: {lastMessagePreview}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {spendingLabel} · {dateLabel}
                  </p>
                  {loadingFanId === fanId ? (
                    <div className="mt-2 h-1.5 w-2/3 animate-pulse rounded-full bg-white/20" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="flex h-screen min-h-0 flex-col overflow-hidden bg-zinc-950 p-5">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            {selectedFanId ? (
              <>
                <div className="shrink-0 border-b border-white/10 p-5">
                  <div>
                    <h2 className="text-xl font-semibold">
                      {getFanDisplayLabel(
                        selectedFanId,
                        fanSummaries[selectedFanId],
                        fanAliases[
                          buildFanAliasKey(account?.id, selectedFanId)
                        ],
                      )}
                    </h2>
                    <p className="text-sm text-zinc-500">
                      Mensajes ordenados cronológicamente
                    </p>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-28">
                  <div className="flex flex-col gap-5">
                    {selectedFullHistoryState?.message ? (
                      <p
                        className={`rounded-2xl border p-3 text-sm ${
                          selectedFullHistoryState.status === "error"
                            ? "border-red-400/30 bg-red-500/10 text-red-100"
                            : selectedFullHistoryState.status === "limited"
                              ? "border-yellow-400/30 bg-yellow-500/10 text-yellow-100"
                              : "border-white/10 bg-black/20 text-zinc-300"
                        }`}
                      >
                        {selectedFullHistoryState.message}
                      </p>
                    ) : null}
                    {isLoadingMessages ? (
                      <p className="text-zinc-400">Cargando mensajes...</p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {messages.map((message) => (
                          <article
                            key={message.id}
                            className={`max-w-[85%] rounded-2xl p-4 ${
                              message.is_sent_by_me
                                ? "ml-auto bg-white text-zinc-950"
                                : "mr-auto border border-white/10 bg-zinc-900 text-white"
                            }`}
                          >
                            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                              {message.is_sent_by_me ? "Creadora" : "Fan"}
                            </p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                              {message.text || "[sin texto]"}
                            </p>
                            <p className="mt-2 text-xs opacity-60">
                              {mounted
                                ? formatDate(message.created_at)
                                : "Cargando fecha..."}
                            </p>
                          </article>
                        ))}
                        <div ref={sentinelRef} className="h-28 shrink-0" />
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => scrollToLastMessage()}
                  disabled={messages.length === 0}
                  className="absolute bottom-24 right-5 z-20 rounded-full border border-white/20 bg-zinc-950/90 px-4 py-2 text-xs font-semibold text-zinc-100 shadow-lg transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Ir al último mensaje
                </button>

                <div className="absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-zinc-950/95 p-4 backdrop-blur">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => loadSpending(selectedFanId)}
                      disabled={
                        !selectedFanId ||
                        loadingSpendingFanId === selectedFanId
                      }
                      className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loadingSpendingFanId === selectedFanId
                        ? "Cargando gasto..."
                        : "Ver gasto"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        loadFullHistoryForFan({
                          fanId: selectedFanId,
                          showInChat: true,
                        }).catch((historyError) =>
                          setError(
                            historyError instanceof Error
                              ? historyError.message
                              : "No se pudo cargar el historial completo.",
                          ),
                        )
                      }
                      disabled={
                        !selectedFanId ||
                        selectedFullHistoryState?.status === "loading" ||
                        selectedFullHistoryState?.status === "complete"
                      }
                      className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {selectedFullHistoryState?.status === "loading"
                        ? "Cargando historial..."
                        : selectedFullHistoryState?.status === "complete"
                          ? "Historial completo cargado"
                          : "Cargar historial completo"}
                    </button>
                    <button
                      type="button"
                      onClick={analyzeConversation}
                      disabled={messages.length === 0 || isAnalyzing}
                      className="rounded-full border border-white/30 px-5 py-2 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isAnalyzing && analyzingFanId === selectedFanId
                        ? "Analizando historial..."
                        : "Analizar conversación"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAnalysisPanel(true)}
                      className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 xl:hidden"
                    >
                      Ver análisis
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-center text-zinc-400">
                Selecciona una conversación para ver los mensajes.
              </p>
            )}
          </div>
        </section>

        <aside className="sticky top-0 hidden h-screen min-h-0 overflow-hidden border-l border-white/10 bg-zinc-950 p-5 xl:block">
          {analysisPanel}
        </aside>
      </section>

      {showAnalysisPanel ? (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 xl:hidden">
          <div className="ml-auto h-full max-w-md">{analysisPanel}</div>
        </div>
      ) : null}

      {showSpendingPanel ? spendingPanel : null}
      {aliasEditorPanel}
    </main>
  );
}
