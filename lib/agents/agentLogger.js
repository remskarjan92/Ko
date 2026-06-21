const { createAgentSuccess, createAgentFailure } = require("./agentResult");

function summarizeValue(value, maxLength = 900) {
  try {
    const json = JSON.stringify(value, (_key, item) => {
      if (typeof item === "string" && item.length > 240) return `${item.slice(0, 240)}...`;
      return item;
    });
    return json.length > maxLength ? `${json.slice(0, maxLength)}...` : json;
  } catch {
    return String(value || "").slice(0, maxLength);
  }
}

async function logAgentRun({
  result,
  agentName = result?.agent,
  input = result?.inputSummary,
  output = result?.data,
  status = result?.status || "success",
  executionTime = result?.executionTime || 0,
  error = result?.error || null,
  persist = null,
}) {
  const entry = {
    agent_name: agentName || "unknown_agent",
    input_summary: typeof input === "string" ? input : summarizeValue(input),
    output,
    status,
    execution_time: Number(executionTime) || 0,
    error: error ? String(error.message || error).slice(0, 1000) : null,
    created_at: result?.createdAt || new Date().toISOString(),
    result: result || null,
  };

  if (status === "success") {
    console.log(`[agent:${agentName}] success`, { executionTime: entry.execution_time });
  } else {
    console.error(`[agent:${agentName}] failed`, entry.error);
  }

  if (typeof persist === "function") {
    try {
      await persist(entry);
    } catch (persistError) {
      console.warn(`[agent:${agentName}] log persistence skipped:`, persistError.message);
    }
  }

  return entry;
}

async function runLoggedAgent(agentName, input, runner, options = {}) {
  const startedAt = Date.now();
  const inputSummary = options.inputSummary || input || {};
  try {
    const output = await runner();
    const result = createAgentSuccess({
      agent: agentName,
      data: output,
      inputSummary,
      executionTime: Date.now() - startedAt,
      model: options.model || null,
      costEstimate: options.costEstimate ?? null,
    });
    await logAgentRun({
      result,
      persist: options.persist,
    });
    return result;
  } catch (error) {
    const result = createAgentFailure({
      agent: agentName,
      error,
      inputSummary,
      executionTime: Date.now() - startedAt,
      fallbackData: options.fallbackData || {},
    });
    await logAgentRun({
      result,
      persist: options.persist,
    });
    throw error;
  }
}

module.exports = {
  logAgentRun,
  runLoggedAgent,
  summarizeValue,
};
