const { runLoggedAgent } = require("./agentLogger");

async function runAutoFixAgent(input, deps = {}) {
  return runLoggedAgent("auto_fix", input, async () => {
    const { gemini, getGeminiText } = deps;
    if (!gemini) {
      const err = new Error("Auto fix service is not configured");
      err.code = "service_missing";
      throw err;
    }

    const parts = [
      { text: input.instruction },
    ];
    if (input.imageBase64) {
      parts.unshift({
        inline_data: {
          mime_type: input.imageType || "image/webp",
          data: input.imageBase64,
        },
      });
    }

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": gemini,
      },
      body: JSON.stringify({
        generationConfig: { maxOutputTokens: 700 },
        contents: [{ role: "user", parts }],
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return { suggestion: getGeminiText(data) };
  }, {
    persist: deps.persistLog,
    model: "gemini-2.5-flash",
    inputSummary: {
      hasImage: !!input.imageBase64,
      imageType: input.imageType || "",
      instructionLength: String(input.instruction || "").length,
      listingRole: input.listingRole || "",
      mockupStyleMode: input.mockupStyleMode || "",
    },
    fallbackData: {
      suggestion: "",
    },
  });
}

module.exports = {
  runAutoFixAgent,
};
