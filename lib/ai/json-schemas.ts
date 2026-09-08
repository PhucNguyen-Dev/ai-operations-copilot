// JSON Schema equivalents of the per-tool validators in lib/ai/schemas.ts.
// These travel WITH each /v1/generate request (Option C): the Gateway
// enforces them for metering truth; the local TS validators in schemas.ts
// re-check the result (defense in depth — the local validator is the
// authority, e.g. the quiz answer_index cross-field rule that JSON Schema
// cannot express).
// Keep in sync with lib/ai/schemas.ts when a tool schema evolves.

export const LEAD_ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['score', 'category', 'intent', 'summary', 'recommended_action'],
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    category: { enum: ['HOT', 'WARM', 'COLD'] },
    intent: { enum: ['HIGH', 'MEDIUM', 'LOW'] },
    summary: { type: 'string', minLength: 1 },
    recommended_action: { type: 'string', minLength: 1 },
  },
} as const

export const CONTENT_DRAFT_SCHEMA = {
  type: 'object',
  required: ['headlines', 'ad_copy', 'ctas'],
  properties: {
    headlines: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string', minLength: 1 } },
    ad_copy: { type: 'string', minLength: 1 },
    ctas: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string', minLength: 1 } },
  },
} as const

export const CAMPAIGN_INSIGHTS_SCHEMA = {
  type: 'object',
  required: ['summary', 'strong_segments', 'weak_segments', 'trends', 'recommendations'],
  properties: {
    summary: { type: 'string', minLength: 1 },
    strong_segments: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1 } },
    weak_segments: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1 } },
    trends: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1 } },
    recommendations: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1 } },
  },
} as const

export const LESSON_PLAN_SCHEMA = {
  type: 'object',
  required: ['title', 'objectives', 'sections', 'homework'],
  properties: {
    title: { type: 'string', minLength: 1 },
    objectives: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1 } },
    sections: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        required: ['title', 'minutes', 'description'],
        properties: {
          title: { type: 'string', minLength: 1 },
          minutes: { type: 'integer', minimum: 1, maximum: 180 },
          description: { type: 'string', minLength: 1 },
        },
      },
    },
    homework: { type: 'string', minLength: 1 },
  },
} as const

export const QUIZ_SCHEMA = {
  type: 'object',
  required: ['title', 'questions'],
  properties: {
    title: { type: 'string', minLength: 1 },
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        required: ['question', 'options', 'answer_index', 'explanation'],
        properties: {
          question: { type: 'string', minLength: 1 },
          options: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', minLength: 1 } },
          answer_index: { type: 'integer', minimum: 0, maximum: 5 },
          explanation: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const

export const OPS_REPORT_SCHEMA = {
  type: 'object',
  required: ['executive_summary', 'key_metrics', 'problems', 'trends', 'recommendations'],
  properties: {
    executive_summary: { type: 'string', minLength: 1 },
    key_metrics: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1 } },
    problems: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1 } },
    trends: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1 } },
    recommendations: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1 } },
  },
} as const

/** Tool id → JSON Schema sent with each Gateway request. */
export const TOOL_SCHEMAS: Record<string, object> = {
  'F-004': LEAD_ANALYSIS_SCHEMA,
  'F-020': CONTENT_DRAFT_SCHEMA,
  'F-021': CAMPAIGN_INSIGHTS_SCHEMA,
  'F-022': LESSON_PLAN_SCHEMA,
  'F-023': QUIZ_SCHEMA,
  'F-024': OPS_REPORT_SCHEMA,
}
