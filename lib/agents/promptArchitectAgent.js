const { runLoggedAgent } = require("./agentLogger");

function extractJsonArray(text) {
  if (!text) return [];
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    console.error("[promptArchitectAgent] no JSON array brackets found", {
      rawLength: text.length,
      preview: text.slice(0, 500),
    });
    return [];
  }
  const slice = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    if (!Array.isArray(parsed)) {
      console.error("[promptArchitectAgent] parsed value is not an array:", typeof parsed);
      return [];
    }
    return parsed;
  } catch (err) {
    console.error("[promptArchitectAgent] JSON.parse failed:", err.message, {
      sliceLength: slice.length,
      tail: slice.slice(-300),
    });
    return [];
  }
}

async function runPromptArchitectAgent(input, deps = {}) {
  return runLoggedAgent("prompt_architect", input, async () => {
    const {
      gemini,
      systemPrompt,
      userMessage,
      imageBase64,
      imageType,
      fetchJsonWithRetry,
      getGeminiText,
      enrichConceptData,
    } = deps;

    if (!gemini) {
      const err = new Error("Prompt architect service is not configured");
      err.code = "service_missing";
      throw err;
    }
    if (!imageBase64) {
      const err = new Error("Design image is required");
      err.code = "bad_request";
      throw err;
    }

    const response = await fetchJsonWithRetry("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: 16000, responseMimeType: "application/json" },
        contents: [{
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: imageType || "image/png",
                data: imageBase64,
              },
            },
            { text: userMessage },
          ],
        }],
      }),
    }, { retries: 3, delayMs: 1500, label: "gemini prompt-architect" });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const raw = getGeminiText(data);
    const concepts = extractJsonArray(raw);
    const enrichedConcepts = concepts.map((concept, index) => enrichConceptData(concept, {
      batchIndex: index,
      printVisibility: input.printVisibility,
      mockupStyleMode: input.mockupStyleMode,
      mockupStyleBrief: input.mockupStyleBrief,
      categoryInfo: input.batch?.[index] || {},
    }));

    return {
      raw,
      concepts,
      enrichedConcepts,
      finishReason: data?.candidates?.[0]?.finishReason || null,
      warning: !enrichedConcepts.length && raw ? "Gemini response could not be parsed into concepts — check server logs for raw output." : undefined,
    };
  }, {
    persist: deps.persistLog,
    model: "gemini-2.5-flash",
    inputSummary: {
      batchSize: Array.isArray(input.batch) ? input.batch.length : 0,
      printVisibility: input.printVisibility || "",
      mockupStyleMode: input.mockupStyleMode || "",
      niche: input.niche || "",
      audience: input.audience || "",
    },
    fallbackData: {
      raw: "",
      concepts: [],
      enrichedConcepts: [],
      finishReason: null,
      warning: "Prompt Architect failed",
    },
  });
}

module.exports = {
  extractJsonArray,
  runPromptArchitectAgent,
};
