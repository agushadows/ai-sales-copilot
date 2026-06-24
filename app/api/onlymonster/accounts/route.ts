export async function GET(request: Request) {
  const apiKey = request.headers.get("x-om-auth-token");

  if (!apiKey) {
    return Response.json(
      { error: "Falta la API key de OnlyMonster." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(
      "https://omapi.onlymonster.ai/api/v0/accounts",
      {
        headers: {
          "x-om-auth-token": apiKey,
        },
      },
    );

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message =
        typeof data === "object" && data !== null && "message" in data
          ? String(data.message)
          : typeof data === "object" && data !== null && "error" in data
            ? String(data.error)
            : "OnlyMonster rechazó la conexión.";

      return Response.json({ error: message }, { status: response.status });
    }

    return Response.json({
      accounts: Array.isArray(data) ? data : data.accounts || data.data || [],
    });
  } catch {
    return Response.json(
      { error: "No se pudo contactar con OnlyMonster." },
      { status: 502 },
    );
  }
}
