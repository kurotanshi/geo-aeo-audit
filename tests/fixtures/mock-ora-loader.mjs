globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://ora.ai/")) {
    throw new Error(`unexpected external request: ${url}`);
  }

  const expectedMode = process.env.MOCK_ORA_EXPECT_MODE ?? "cached";
  if (expectedMode === "scan") {
    if (url !== "https://ora.ai/api/scan?include=essentials&format=audit" || init.method !== "POST") {
      throw new Error(`unexpected Ora scan request: ${init.method} ${url}`);
    }
    const body = JSON.parse(String(init.body));
    if (body.url !== "https://example.com/path") throw new Error("unexpected Ora scan target");
  } else if (
    url !== "https://ora.ai/api/score/example.com?include=essentials&format=audit" ||
    init.method !== "GET"
  ) {
    throw new Error(`unexpected Ora cache request: ${init.method} ${url}`);
  }

  const headers = new Headers(init.headers);
  if (headers.has("authorization") || headers.has("cookie") || headers.has("x-api-key")) {
    throw new Error("Ora request included credentials");
  }

  const mode = process.env.MOCK_ORA_MODE ?? "success";
  if (mode === "404") return new Response("", { status: 404 });
  if (mode === "429") return new Response("", { status: 429, headers: { "retry-after": "23" } });
  if (mode !== "success") throw new Error(`unknown MOCK_ORA_MODE: ${mode}`);

  return new Response(JSON.stringify({
    contractVersion: "1.21.0",
    score: 72,
    grade: "B",
    scannedAt: "2026-08-25T00:00:00.000Z",
    analysisStatus: "complete",
    pendingChecks: [],
    layers: [{ id: "discovery", name: "Discovery", score: 12, maxScore: 20 }],
    topFixes: [
      { id: "second", name: "Second fix", recommendation: "Fix second", estScoreGain: 4 },
      { id: "first", name: "First fix", recommendation: "Fix first", estScoreGain: 2 },
    ],
    essentials: {
      score: 80,
      label: "Ready",
      checks: { "metadata-completeness": {} },
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json", age: "60", "x-vercel-cache": "HIT" },
  });
};
