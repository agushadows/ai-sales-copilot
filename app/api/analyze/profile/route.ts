import { randomUUID } from "node:crypto";
import { buildFanIntelligenceKey, getPersistentJson } from "../cache";

export async function GET(request: Request) {
  const requestId = randomUUID();
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const fanId = searchParams.get("fanId");

  if (!accountId || !fanId) {
    return Response.json(
      { error: "Falta accountId o fanId." },
      { status: 400 },
    );
  }

  const profileKey = buildFanIntelligenceKey(accountId, fanId);
  const profile = await getPersistentJson(profileKey, {
    accountId,
    cacheKey: profileKey,
    endpoint: "/api/analyze/profile",
    fanId,
    phase: "profile-read",
    requestId,
  });

  return Response.json({ profile, requestId });
}
