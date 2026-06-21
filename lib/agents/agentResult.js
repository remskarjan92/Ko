function safeInputSummary(inputSummary) {
  if (!inputSummary || typeof inputSummary !== "object" || Array.isArray(inputSummary)) {
    return {};
  }
  return inputSummary;
}

function createAgentSuccess({
  agent,
  data = {},
  inputSummary = {},
  executionTime = 0,
  model = null,
  costEstimate = null,
}) {
  return {
    agent,
    success: true,
    status: "success",
    executionTime: Number(executionTime) || 0,
    inputSummary: safeInputSummary(inputSummary),
    model,
    costEstimate,
    data: data && typeof data === "object" ? data : {},
    error: null,
    createdAt: new Date().toISOString(),
  };
}

function createAgentFailure({
  agent,
  error,
  inputSummary = {},
  executionTime = 0,
  fallbackData = {},
}) {
  return {
    agent,
    success: false,
    status: "error",
    executionTime: Number(executionTime) || 0,
    inputSummary: safeInputSummary(inputSummary),
    model: null,
    costEstimate: null,
    data: fallbackData && typeof fallbackData === "object" ? fallbackData : {},
    error: error ? String(error.message || error).slice(0, 1000) : "Agent failed",
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  createAgentSuccess,
  createAgentFailure,
};
