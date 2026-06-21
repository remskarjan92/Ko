const { runQualityInspectorAgent } = require("./agents/qualityInspectorAgent");
const { runPromptArchitectAgent } = require("./agents/promptArchitectAgent");
const { runEtsyResearchAgent } = require("./agents/etsyResearchAgent");
const { runAutoFixAgent } = require("./agents/autoFixAgent");
const { runLearningAgent } = require("./agents/learningAgent");

const AGENTS = {
  quality_inspector: runQualityInspectorAgent,
  prompt_architect: runPromptArchitectAgent,
  etsy_research: runEtsyResearchAgent,
  auto_fix: runAutoFixAgent,
  learning: runLearningAgent,
};

async function runAgent(agentName, input = {}, deps = {}) {
  const agent = AGENTS[agentName];
  if (!agent) {
    const err = new Error(`Unknown agent: ${agentName}`);
    err.code = "unknown_agent";
    throw err;
  }
  return agent(input, deps);
}

async function runMockupQualityPipeline(input = {}, deps = {}) {
  const qualityResult = await runAgent("quality_inspector", {
    imageUrl: input.imageUrl,
    originalDesignUrl: input.originalDesignUrl,
    mockupPrompt: input.mockupPrompt,
  }, deps);
  const qualityReport = qualityResult.data;

  let fix = null;
  if (qualityReport.recommended_action === "fix" && qualityReport.fix_prompt) {
    fix = await runAgent("auto_fix", {
      instruction: qualityReport.fix_prompt,
      imageBase64: input.imageBase64,
      imageType: input.imageType,
    }, deps).catch(() => null);
  }

  return { qualityReport, qualityResult, fix };
}

module.exports = {
  AGENTS,
  runAgent,
  runMockupQualityPipeline,
};
