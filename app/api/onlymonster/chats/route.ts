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

function readId(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return readStringField(value, ["id", "fan_id", "fanId"]);
}

function extractFanProfiles(data: unknown) {
  const sourceItems =
    typeof data === "object" && data !== null && Array.isArray((data as Record<string, unknown>).items)
      ? ((data as Record<string, unknown>).items as unknown[])
      : typeof data === "object" && data !== null && Array.isArray((data as Record<string, unknown>).fans)
        ? ((data as Record<string, unknown>).fans as unknown[])
        : [];

  return sourceItems.reduce<Record<string, { name: string | null; username: string | null; avatar: string | null }>>(
    (profiles, item) => {
      const fanId = readId(item);

      if (!fanId) {
        return profiles;
      }

      const name = readStringField(item, [
        "name",
        "display_name",
        "displayName",
        "fan_name",
        "fanName",
        "nickname",
        "profile_name",
      ]);
      const username = readStringField(item, ["username"]);
      const avatar = readStringField(item, ["avatar", "avatar_url"]);

      if (name || username || avatar) {
        profiles[fanId] = { name, username, avatar };
      }

      return profiles;
    },
    {},
  );
}

export async function GET(request: Request) {
  const apiKey = request.headers.get("x-om-auth-token");
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");

  if (!apiKey) {
    return Response.json(
      { error: "Falta la API key de OnlyMonster." },
      { status: 400 },
    );
  }

  if (!accountId) {
    return Response.json(
      { error: "Falta la cuenta seleccionada de OnlyMonster." },
      { status: 400 },
    );
  }

  const fansResponse = await fetch(
    `https://omapi.onlymonster.ai/api/v0/accounts/${accountId}/fans?limit=20`,
    {
      headers: {
        "x-om-auth-token": apiKey,
      },
    },
  );
  const fansData = await readOnlyMonsterJson(fansResponse);

  if (!fansResponse.ok) {
    if (fansResponse.status === 429) {
      const retryAfter = retryAfterSeconds(fansResponse);

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
          fansData,
          "OnlyMonster no permitió leer conversaciones recientes.",
        ),
      },
      { status: fansResponse.status },
    );
  }

  const fanIds = Array.isArray(fansData.fan_ids)
    ? fansData.fan_ids.map(String)
    : Object.keys(extractFanProfiles(fansData));
  const fanProfiles = extractFanProfiles(fansData);

  return Response.json({ fanIds, fanProfiles });
}
