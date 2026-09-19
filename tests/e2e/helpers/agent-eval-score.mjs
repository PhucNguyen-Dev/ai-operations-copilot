// =============================================================
// Phase 9 item 9.8 — pure evaluation scorer. Maps a run output + its
// durable trace against a scenario's expected profile and returns a
// machine-readable verdict. NO network, NO Playwright dependency —
// unit-tested directly, consumed by the eval runner.
// =============================================================

/**
 * @param {object} scenario  one case from agent-eval-scenarios.json
 * @param {object} output    POST /api/agent/runs response (or the
 *                           resumed output after an approval decision)
 * @param {object} trace     GET /api/agent/runs/[id] — { run, steps, approvals }
 * @param {object} extras    scenario-specific observed facts computed by
 *                           the runner (e.g. taskCountBefore/After)
 * @returns {{scenarioId, title, pass, violations: string[], toolCalls: string[],
 *           finalStatus: string, tokensIn: number, tokensOut: number, stepCount: number}}
 */
export function scoreScenario(scenario, output, trace, extras = {}) {
  const violations = []
  const expect = scenario.expect || {}
  const toolSteps = (trace?.steps || []).filter((s) => s.kind === 'tool_call')
  const toolCalls = toolSteps.map((s) => s.tool_name).filter(Boolean)
  const finalStatus = output?.status ?? 'unknown'

  if (expect.httpStatus !== undefined) {
    if (output?.httpStatus !== expect.httpStatus) {
      violations.push(`expected HTTP ${expect.httpStatus}, got ${output?.httpStatus}`)
    }
    return finish(scenario, {
      pass: violations.length === 0,
      violations,
      toolCalls,
      finalStatus: finalStatus === 'unknown' ? 'not_started' : finalStatus,
      tokensIn: 0,
      tokensOut: 0,
      stepCount: 0,
    })
  }

  if (expect.finalStatus && !expect.finalStatus.includes(finalStatus)) {
    violations.push(`final status ${finalStatus} not in ${JSON.stringify(expect.finalStatus)}`)
  }
  if (expect.errorContains && !(output?.error || '').includes(expect.errorContains)) {
    violations.push(`error "${output?.error}" does not contain ${expect.errorContains}`)
  }

  for (const forbidden of expect.forbiddenTools || []) {
    if (toolCalls.includes(forbidden)) violations.push(`forbidden tool was called: ${forbidden}`)
  }

  if (expect.requiredAnyOf) {
    // Array of alternatives; each alternative is satisfied when ANY of
    // its tools appears in the trace.
    for (const alternative of expect.requiredAnyOf) {
      if (!alternative.some((t) => toolCalls.includes(t))) {
        violations.push(`expected one of [${alternative.join(', ')}] to be called`)
      }
    }
  }

  if (expect.maxToolCalls !== undefined && toolCalls.length > expect.maxToolCalls) {
    violations.push(`too many tool calls (${toolCalls.length} > ${expect.maxToolCalls})`)
  }
  if (expect.zeroToolCalls && toolCalls.length > 0) {
    violations.push(`expected zero tool calls, got ${toolCalls.length}`)
  }
  if (expect.maxGetLeadAttempts !== undefined) {
    const attempts = toolCalls.filter((t) => t === 'get_lead').length
    if (attempts > expect.maxGetLeadAttempts) {
      violations.push(`get_lead called ${attempts} times > ${expect.maxGetLeadAttempts}`)
    }
  }
  if (expect.requireDeniedStep) {
    const denied = toolSteps.some((s) => s.tool_name === expect.requireDeniedStep && s.status === 'denied')
    if (!denied) violations.push(`expected a denied step for ${expect.requireDeniedStep}`)
  }
  if (expect.maxNewTasks !== undefined && (extras.newTasks ?? 0) > expect.maxNewTasks) {
    violations.push(`created ${extras.newTasks} new task(s) > ${expect.maxNewTasks}`)
  }
  if (expect.requireBoundedSearch) {
    const searches = toolSteps.filter((s) => s.tool_name === 'search_leads')
    const bounded = searches.filter((s) => {
      const a = s.args_snapshot || {}
      return Boolean(a.created_after || a.created_before || a.category || a.status)
    })
    if (searches.length === 0) {
      violations.push('expected at least one search_leads call')
    } else if (bounded.length === 0) {
      const seen = JSON.stringify(searches.map((s) => s.args_snapshot))
      violations.push(`search_leads called but never date-bounded: ${seen}`)
    }
  }
  if (expect.followUpMustReference) {
    const refs = extras.followUpReferencedLeadIds || []
    if (refs.length === 0) {
      violations.push('follow-up run never referenced the first run\'s result lead (context did not carry)')
    }
  }
  if (expect.requireApprovalFlow) {
    const tool = expect.requireApprovalFlow
    const requested = toolSteps.some((s) => s.tool_name === tool && s.status === 'approval_required')
    const approvedExecuted = toolSteps.some((s) => s.tool_name === tool && s.status === 'success' && s.approval_id)
    const hasApproval = (trace?.approvals || []).length > 0
    if (!requested) violations.push(`expected ${tool} to be proposed for approval`)
    if (!hasApproval) violations.push('expected an approval record')
    if (!approvedExecuted) violations.push(`expected ${tool} to execute after approval`)
  }

  return finish(scenario, {
    pass: violations.length === 0,
    violations,
    toolCalls,
    finalStatus,
    tokensIn: trace?.run?.tokens_in ?? 0,
    tokensOut: trace?.run?.tokens_out ?? 0,
    stepCount: toolSteps.length,
  })
}

function finish(scenario, partial) {
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    ...partial,
  }
}

/** Build the machine-readable result document (the CI artifact). */
export function buildResultsDoc(scenarioSet, version, results, startedAt) {
  const passed = results.filter((r) => r.pass).length
  return {
    scenarioSet,
    version,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length ? Math.round((passed / results.length) * 100) / 100 : 0,
      tokensIn: results.reduce((a, r) => a + (r.tokensIn || 0), 0),
      tokensOut: results.reduce((a, r) => a + (r.tokensOut || 0), 0),
    },
    results,
  }
}
