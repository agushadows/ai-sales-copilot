export type FullContextCacheEntry = {
  accountId: string;
  fanId: string;
  platformAccountId: string;
  updatedAt: number;
  value: unknown;
};

type FullContextCacheStore = {
  entries: Map<string, FullContextCacheEntry>;
};

const globalForFullContext = globalThis as typeof globalThis & {
  onlyMonsterFullContextCache?: FullContextCacheStore;
};

export const fullContextCache =
  globalForFullContext.onlyMonsterFullContextCache ||
  (globalForFullContext.onlyMonsterFullContextCache = {
    entries: new Map<string, FullContextCacheEntry>(),
  });

export function buildFullContextCacheKey({
  accountId,
  fanId,
  platformAccountId,
}: {
  accountId: string;
  fanId: string;
  platformAccountId: string;
}) {
  return `${accountId}:${platformAccountId}:${fanId}`;
}

export function invalidateFullContextCache({
  accountId,
  fanId,
}: {
  accountId: string | null;
  fanId: string | null;
}) {
  if (!accountId || !fanId) {
    return;
  }

  for (const [key, entry] of fullContextCache.entries) {
    if (entry.accountId === accountId && entry.fanId === fanId) {
      fullContextCache.entries.delete(key);
    }
  }
}
