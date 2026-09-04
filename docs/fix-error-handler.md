# error-handler.json Fix Required

## Problem
`n8n/error-handler.json` is invalid JSON. The `jsCode` string in the "Build error payload" node has literal newlines instead of escaped `\n` sequences (line 17, column 86). This causes `npm run push:n8n` to fail with:

```
error-handler.json is not valid JSON: Bad control character in string literal in JSON at position 497
```

Both the working file AND the git HEAD version (commit 5c9d0f6) are broken — the file was committed with this defect.

## Impact
- `npm run push:n8n` fails (the push script validates JSON before importing)
- The error handler workflow cannot be loaded by n8n
- The main pipeline (`admissions-lead-pipeline.json`) is UNAFFECTED — it is valid JSON and works correctly
- If an unhandled error occurs in the main pipeline, it is still logged as failed via the pipeline's own logic; only the dedicated error-handler workflow is missing

## Fix

Replace the file with valid JSON. The `jsCode` string must have `\n` (escaped newlines), not literal newlines.

### Option A: Regenerate from Node script

Create and run this script:

```js
import { writeFileSync, readFileSync } from "fs";

const wf = {
  id: "errf013000000001",
  name: "Admissions Error Handler (F-013)",
  active: false,
  settings: { executionOrder: "v1" },
  nodes: [
    {
      parameters: {},
      id: "b1000000-0000-0000-0000-000000000001",
      name: "On pipeline error",
      type: "n8n-nodes-base.errorTrigger",
      typeVersion: 1,
      position: [0, 0]
    },
    {
      parameters: {
        jsCode: `// F-013 - Extract error info from the crashed pipeline execution.
const item = $input.first().json;
const workflowName = item?.workflow?.name || "unknown";
const lastNode = item?.execution?.lastNodeExecuted || "unknown";
const errorMessage = item?.execution?.error?.message || "unknown";
return [{ json: {
  workflow_name: workflowName,
  trigger_source: "error-workflow",
  status: "failed",
  error_summary: "Unhandled error at " + lastNode + ": " + errorMessage
} }];`
      },
      id: "b1000000-0000-0000-0000-000000000002",
      name: "Build error payload",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [220, 0]
    },
    {
      parameters: {
        method: "POST",
        url: "={{ $env.SUPABASE_URL }}/rest/v1/automation_runs",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "apikey", value: "={{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
            { name: "Authorization", value: "=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
            { name: "Content-Type", value: "application/json" },
            { name: "Prefer", value: "return=representation" }
          ]
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify({ workflow_name: $json.workflow_name, trigger_source: $json.trigger_source, status: $json.status, error_summary: $json.error_summary, started_at: new Date().toISOString(), finished_at: new Date().toISOString() }) }}",
        options: { timeout: 15000, retryOnFail: true }
      },
      id: "b1000000-0000-0000-0000-000000000003",
      name: "Record crashed run",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [440, 0]
    }
  ],
  connections: {
    "On pipeline error": { main: [[{ node: "Build error payload", type: "main", index: 0 }]] },
    "Build error payload": { main: [[{ node: "Record crashed run", type: "main", index: 0 }]] }
  }
};

writeFileSync("n8n/error-handler.json", JSON.stringify(wf, null, 2));
JSON.parse(readFileSync("n8n/error-handler.json", "utf8"));
console.log("Fixed and validated error-handler.json");
```

### Option B: Manual fix

Open `n8n/error-handler.json`, find the `"jsCode":` value (line 17), and replace all literal newlines inside that string with `\n`. The string should be on a single logical line with `\n` escape sequences.

## After Fix

1. Verify: `node -e "JSON.parse(require('fs').readFileSync('n8n/error-handler.json','utf8')); console.log('valid')"`
2. Commit: `git add n8n/error-handler.json && git commit -m "Fix error-handler.json JSON escaping"`
3. Push: `npm run push:n8n` (stop n8n first with Ctrl+C, then `npm run n8n` after)

## Context

- The main pipeline `n8n/admissions-lead-pipeline.json` is valid and has 36 nodes (Phase 4 complete: F-003 through F-011 + F-013 error workflow reference)
- The error handler is referenced by the main pipeline via `settings.errorWorkflow`
- Phase 4 is functionally complete even without the error handler — the pipeline handles its own failures
- The error handler is a safety net for UNHANDLED crashes (catches bugs in the pipeline code itself)
