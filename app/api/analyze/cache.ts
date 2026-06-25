type MemoryStore = Map<string, unknown>;

export type CacheLogContext = {
  accountId?: string;
  cacheKey?: string;
  endpoint?: string;
  fanId?: string;
  phase?:
    | "cache-read"
    | "cache-write"
    | "profile-read"
    | "profile-write"
    | "OpenAI"
    | "transactions"
    | "cache-config"
    | string;
  requestId?: string;
};

type KvConfigResult =
  | {
      config: {
        token: string;
        url: string;
      };
      warning: null;
    }
  | {
      config: null;
      warning: string;
    };

const PERSISTENCE_WARNING =
  "Persistencia no configurada; análisis ejecutado sin caché";

const globalForAnalyzeCache = globalThis as typeof globalThis & {
  salesCopilotAnalyzeCache?: MemoryStore;
};

const memoryStore =
  globalForAnalyzeCache.salesCopilotAnalyzeCache ||
  (globalForAnalyzeCache.salesCopilotAnalyzeCache = new Map<string, unknown>());

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getErrorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

function safeUrlPreview(value: string) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.replace(/[^\w.-]/g, "_").slice(0, 120);
  }
}

function logCacheIssue(error: unknown, context: CacheLogContext) {
  console.error("[analysis-cache]", {
    accountId: context.accountId,
    cacheKey: context.cacheKey,
    endpoint: context.endpoint || "/api/analyze",
    fanId: context.fanId,
    message: getErrorMessage(error),
    phase: context.phase,
    requestId: context.requestId,
    stack: getErrorStack(error),
  });
}

function getKvConfig(context?: CacheLogContext): KvConfigResult {
  const rawUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!rawUrl || !token) {
    return { config: null, warning: PERSISTENCE_WARNING };
  }

  try {
    const parsedUrl = new URL(rawUrl);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error(`Protocolo KV inválido: ${parsedUrl.protocol}`);
    }

    return {
      config: {
        token,
        url: parsedUrl.toString(),
      },
      warning: null,
    };
  } catch (error) {
    logCacheIssue(
      new Error(
        `URL de KV/Redis inválida: ${safeUrlPreview(rawUrl)}. ${getErrorMessage(
          error,
        )}`,
      ),
      {
        ...context,
        phase: context?.phase || "cache-config",
      },
    );

    return { config: null, warning: PERSISTENCE_WARNING };
  }
}

async function kvCommand(command: unknown[], context?: CacheLogContext) {
  const { config, warning } = getKvConfig(context);

  if (!config) {
    return { result: null, warning };
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `KV command failed: ${response.status} ${body.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as { result?: unknown };

  return { result: data.result ?? null, warning: null };
}

export function safeCachePart(value: string | number | null | undefined) {
  const rawValue = String(value ?? "unknown");
  const encoded = Buffer.from(rawValue, "utf8").toString("base64url");

  return encoded || "empty";
}

export function buildFanIntelligenceKey(accountId: string, fanId: string) {
  return `fan-intelligence:${safeCachePart(accountId)}:${safeCachePart(fanId)}`;
}

export function getPersistenceWarning() {
  return getKvConfig({ phase: "cache-config" }).warning;
}

export async function getPersistentJson<T>(
  key: string,
  context?: CacheLogContext,
) {
  try {
    const { result: kvValue } = await kvCommand(["GET", key], {
      ...context,
      cacheKey: key,
    });

    if (typeof kvValue === "string") {
      return JSON.parse(kvValue) as T;
    }

    if (kvValue !== null) {
      return kvValue as T;
    }
  } catch (error) {
    logCacheIssue(error, {
      ...context,
      cacheKey: key,
    });
  }

  return (memoryStore.get(key) as T | undefined) || null;
}

export async function setPersistentJson(
  key: string,
  value: unknown,
  ttlSeconds?: number,
  context?: CacheLogContext,
) {
  const serializedValue = JSON.stringify(value);
  const command = ttlSeconds
    ? ["SET", key, serializedValue, "EX", ttlSeconds]
    : ["SET", key, serializedValue];

  try {
    const { warning } = await kvCommand(command, {
      ...context,
      cacheKey: key,
    });

    if (warning) {
      memoryStore.set(key, value);
      return { ok: false, warning };
    }

    return { ok: true, warning: null };
  } catch (error) {
    logCacheIssue(error, {
      ...context,
      cacheKey: key,
    });
    memoryStore.set(key, value);

    return { ok: false, warning: PERSISTENCE_WARNING };
  }
}

export async function deletePersistentKey(
  key: string,
  context?: CacheLogContext,
) {
  try {
    const { warning } = await kvCommand(["DEL", key], {
      ...context,
      cacheKey: key,
    });

    if (warning) {
      memoryStore.delete(key);
    }
  } catch (error) {
    logCacheIssue(error, {
      ...context,
      cacheKey: key,
    });
    memoryStore.delete(key);
  }
}

export async function clearAnalyzeResultCache(context?: CacheLogContext) {
  if (!getPersistenceWarning()) {
    // The per-fan profile cache invalidates by timestamp/hash. This hook remains
    // intentionally light because Redis key scans are not safe in hot webhook paths.
    return;
  }

  for (const key of memoryStore.keys()) {
    if (key.startsWith("analysis:")) {
      await deletePersistentKey(key, context);
    }
  }
}
