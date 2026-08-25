const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = String(input);
  const provider = url.includes("api.openai.com") ? "openai" : url.includes("api.anthropic.com") ? "anthropic" : null;
  if (provider === null) return originalFetch(input, init);
  if (process.env.EXPECTED_PROVIDER !== provider) throw new Error(`unexpected provider endpoint: ${provider}`);

  const headers = new Headers(init?.headers);
  const credential = headers.get("authorization") ?? headers.get("x-api-key") ?? "missing";
  if (process.env.MOCK_PROVIDER_MODE === "error") {
    throw new Error(`authorization=${credential}`);
  }
  const body = JSON.parse(String(init?.body));
  if (provider === "openai") {
    return Response.json({
      id: "resp_e2e",
      model: body.model,
      output: [{
        type: "message",
        content: [{ type: "output_text", text: body.input, annotations: [] }],
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }, { headers: { "x-request-id": "req_e2e" } });
  }
  return Response.json({
    id: "msg_e2e",
    model: body.model,
    content: [{ type: "text", text: body.messages[0].content, citations: [] }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  }, { headers: { "request-id": "req_e2e" } });
};
