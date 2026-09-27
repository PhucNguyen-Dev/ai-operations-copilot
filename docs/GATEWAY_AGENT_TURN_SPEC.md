# Gateway `agent-turn` contract spec (Bundle C2)

**Status: SPEC ONLY — not implemented.** The AI Gateway (platform service #1, separate repo) speaks JSON-mode `generateContent` today; the Copilot agent loop therefore bypasses it, because loop turns need **function calling** and full-turn parts. This spec defines the endpoint that closes that gap. Until it ships, loop turns call Gemini directly (`lib/gemini.ts → generateAgentTurn` / `generateAgentTurnStream`) with identical error classification, retry policy and error normalization.

## Why the loop is special (constraints the Gateway must honor)

1. **Function calling, not JSON mode.** The model picks among tool declarations; the response is a *parts array* (`functionCall` parts + text parts), not a parseable JSON document. There is no schema gate on the whole response — each tool's arguments are validated by the runtime's permission engine + tool validators instead.
2. **Byte-faithful replay.** The runtime persists the FULL requestable parts of every model turn (thought_signature included) and replays them verbatim on resume. The Gateway must pass parts through **unmodified** — any normalization breaks resume.
3. **Never cached.** The conversation changes every turn; caching loop turns is correctness-breaking, not an optimization miss.
4. **Metering truth.** Token usage (`usageMetadata`) must be surfaced per call — it feeds the durable run's token budget and PromptLedger traces.

## Endpoint

`POST /v1/agent-turn`

### Request

```json
{
  "model": "gemini-3.5-flash-lite",
  "system": "<system instruction text, incl. the run-start UTC anchor>",
  "contents": [ { "role": "user|model", "parts": [ ...raw provider parts... ] } ],
  "declarations": [ { "name": "search_leads", "description": "...", "parameters": { ... } } ],
  "prompt_version": 3,
  "prompt_source": "live",
  "options": { "temperature": 0, "timeout_ms": 90000 }
}
```

`contents`/`declarations` are the provider-shaped objects the Copilot already builds (same JSON the direct path sends to `generateContent`).

### Response (200)

```json
{
  "data": {
    "parts": [ ...raw requestable parts, UNMODIFIED (thought_signature preserved)... ],
    "model_version": "gemini-3.5-flash-lite-002"
  },
  "meta": {
    "cached": false,
    "tokens_in": 1234,
    "tokens_out": 567,
    "latency_ms": 842,
    "metered": true
  }
}
```

### Error envelope

Same codes as `/v1/generate` (`docs/EXTERNAL_API.md`), with one addition:

| Code | Meaning | Copilot mapping |
|---|---|---|
| `AI_UNREACHABLE` | provider/network/429/5xx — retryable | retry once, then fail the run turn |
| `AI_BAD_OUTPUT` | empty turn (no calls AND no text) — NOT retried at the Gateway | runtime records `MODEL_TURN_FAILED` |
| `AI_CONFIG` / `UNAUTHORIZED` / `VALIDATION` | permanent | fail the run turn, log loudly |

## Consumer-side behavior when implemented

* `generateAgentTurn` / `generateAgentTurnStream` dispatch to the Gateway when `AI_GATEWAY_URL` + `AI_GATEWAY_KEY` are set (same static-switch, no auto-failover rule as `gatewayGenerate` — a Gateway outage surfaces as clean `AI_UNREACHABLE`, never a silent double-spend on the direct path).
* The Copilot keeps its **local** validations (empty-turn check, requestable-parts filter) as defense in depth — the Gateway is a transport + metering layer, not a behavior authority for the loop.
* `prompt_version` / `prompt_source` ride along purely for Gateway-side metering joins against PromptLedger.

## Acceptance checks for the Gateway implementation

1. Parts round-trip byte-for-byte (thought_signature survives) — assert on a recorded fixture conversation.
2. `usageMetadata` from the provider is forwarded; a call without it reports `null` tokens, not zero.
3. Streaming variant (`POST /v1/agent-turn/stream`, SSE) emits provider chunks unmerged so `onDelta` parity is preserved; the final chunk carries the same `meta` as the non-streamed response.
4. No caching layer engaged for this endpoint regardless of Gateway-wide cache settings.
