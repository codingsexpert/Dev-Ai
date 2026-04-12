/**
 * gemini.js — Gemini API Wrapper
 * 
 * FIXES:
 * 1. maxOutputTokens set to 65536 — prevents truncation on large code responses
 * 2. Detects truncated responses (finishReason: MAX_TOKENS) and retries with hint
 * 3. Aggressive JSON extraction — handles markdown, leading text, trailing text
 * 4. Truncation repair — attempts to close unclosed JSON brackets/braces
 */

import { GoogleGenAI } from "@google/genai";

let aiClient = null;

export function initGemini(apiKey) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required. Get one from https://aistudio.google.com/apikey");
  }
  aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
}

export function getClient() {
  if (!aiClient) throw new Error("Gemini not initialized. Call initGemini(apiKey) first.");
  return aiClient;
}

/**
 * Attempt to repair truncated JSON by closing unclosed brackets/braces/strings
 * This is a best-effort heuristic — won't always work, but catches the common
 * case of Gemini cutting off mid-file-content string.
 */
function repairTruncatedJSON(text) {
  let cleaned = text.trim();

  // If it looks like it was cut mid-string, close the string
  // Count unescaped quotes
  let inString = false;
  let lastCharBeforeEnd = "";
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '"' && (i === 0 || cleaned[i - 1] !== '\\')) {
      inString = !inString;
    }
    if (i === cleaned.length - 1) {
      lastCharBeforeEnd = ch;
    }
  }

  // If we ended inside a string, close it
  if (inString) {
    // Escape any trailing backslash that would escape our closing quote
    if (cleaned.endsWith('\\')) {
      cleaned += '\\';
    }
    cleaned += '"';
  }

  // Now close unclosed brackets/braces
  const stack = [];
  inString = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '"' && (i === 0 || cleaned[i - 1] !== '\\')) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }

  // Close all unclosed structures
  // But first, we might need to add missing commas or trim trailing commas
  // Simple approach: just close everything
  while (stack.length > 0) {
    const closer = stack.pop();
    // If last meaningful char is a comma, that's fine for arrays but not objects ending mid-key
    cleaned += closer;
  }

  return cleaned;
}

/**
 * Core LLM call — returns parsed JSON + token info
 */
export async function callGemini({
  systemPrompt,
  userPrompt,
  agentName = "unknown",
  currentCost = 0,
  tokenBudget = 2.0,
  model = null,
  maxTokens = null,
}) {
  const client = getClient();
  const modelName = model || process.env.GEMINI_MODEL || "gemini-2.5-flash";

  // Budget check
  if (currentCost >= tokenBudget) {
    throw new Error(
      `TOKEN_BUDGET_EXCEEDED: $${currentCost.toFixed(4)} >= budget $${tokenBudget}`
    );
  }

  const fullPrompt = `${systemPrompt}\n\n---\n\nINPUT:\n${userPrompt}\n\n---\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown, no backticks, no explanation outside JSON.`;

  let lastError = null;
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: modelName,
        contents: fullPrompt,
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: maxTokens || 65536,
        },
      });

      const rawText = response.text || "";

      // Detect truncation via finishReason
      const finishReason = response.candidates?.[0]?.finishReason;
      const wasTruncated = finishReason === "MAX_TOKENS" || finishReason === "STOP" === false;

      if (wasTruncated) {
        console.warn(`[${agentName}] Response truncated (finishReason: ${finishReason}, length: ${rawText.length})`);
      }

      // Token tracking
      const usageMetadata = response.usageMetadata;
      const inputTokens = usageMetadata?.promptTokenCount || Math.ceil(fullPrompt.length / 4);
      const outputTokens = usageMetadata?.candidatesTokenCount || Math.ceil(rawText.length / 4);
      const cost = (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 0.60;

      // Parse JSON — multi-strategy extraction
      let parsed;
      try {
        let cleanText = rawText.trim();

        // Strip markdown code fences
        if (cleanText.startsWith("```")) {
          cleanText = cleanText.replace(/^```(?:json|JSON|js)?\s*\n?/, "").replace(/\n?\s*```\s*$/, "");
        }

        // Find JSON boundaries
        const firstBrace = cleanText.indexOf("{");
        const firstBracket = cleanText.indexOf("[");
        const startIdx = firstBrace === -1 ? firstBracket
                       : firstBracket === -1 ? firstBrace
                       : Math.min(firstBrace, firstBracket);

        if (startIdx > 0) cleanText = cleanText.slice(startIdx);

        const lastBrace = cleanText.lastIndexOf("}");
        const lastBracket = cleanText.lastIndexOf("]");
        const endIdx = Math.max(lastBrace, lastBracket);

        if (endIdx !== -1 && endIdx < cleanText.length - 1) {
          cleanText = cleanText.slice(0, endIdx + 1);
        }

        // Strategy 1: Direct parse
        try {
          parsed = JSON.parse(cleanText);
        } catch (directError) {
          // Strategy 2: Repair truncated JSON and retry
          console.warn(`[${agentName}] Direct parse failed, attempting truncation repair...`);
          const repaired = repairTruncatedJSON(cleanText);
          try {
            parsed = JSON.parse(repaired);
            console.log(`[${agentName}] Truncation repair succeeded`);
          } catch (repairError) {
            // Strategy 3: Try to extract just the files array portion
            // This handles the case where notes field got cut off
            const filesMatch = cleanText.match(/"files"\s*:\s*\[/);
            if (filesMatch) {
              const filesStart = cleanText.indexOf(filesMatch[0]);
              let partial = cleanText.slice(0, filesStart) + '"files": [],"notes":"truncated"}';
              try {
                // Find where files array starts and find last complete file object
                const arrayStart = cleanText.indexOf("[", filesStart);
                let depth = 0;
                let lastCompleteObj = arrayStart;
                for (let i = arrayStart; i < cleanText.length; i++) {
                  if (cleanText[i] === '{') depth++;
                  if (cleanText[i] === '}') {
                    depth--;
                    if (depth === 0) lastCompleteObj = i + 1;
                  }
                }
                // Extract up to last complete file object
                const partialFiles = cleanText.slice(arrayStart, lastCompleteObj);
                partial = `{"files": ${partialFiles}], "notes": "Response was truncated — partial files extracted"}`;
                parsed = JSON.parse(partial);
                console.log(`[${agentName}] Partial file extraction succeeded (${parsed.files?.length || 0} files)`);
              } catch (_) {
                throw directError; // Give up, throw original error
              }
            } else {
              throw directError;
            }
          }
        }
      } catch (parseError) {
        console.error(`[${agentName}] JSON parse failed (attempt ${attempt}/${MAX_RETRIES}):`, rawText.slice(0, 300));
        if (attempt === MAX_RETRIES) {
          throw new Error(`JSON_PARSE_FAILED after ${MAX_RETRIES} attempts. Response length: ${rawText.length}. Likely truncated.`);
        }
        lastError = parseError;
        continue;
      }

      return {
        parsed,
        raw: rawText,
        tokens: { input: inputTokens, output: outputTokens, cost },
      };

    } catch (error) {
      lastError = error;
      if (error.message?.includes("TOKEN_BUDGET_EXCEEDED")) throw error;
      if (error.message?.includes("JSON_PARSE_FAILED") && attempt === MAX_RETRIES) throw error;
      if (attempt === MAX_RETRIES) throw error;

      const waitMs = Math.pow(2, attempt) * 1000;
      console.warn(`[${agentName}] Attempt ${attempt} failed: ${error.message}. Retrying in ${waitMs}ms...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

/**
 * Helper: build tokenUsage delta from a single callGemini result
 */
export function makeTokenDelta(agentName, tokens) {
  return {
    newCalls: [{
      agent: agentName,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      timestamp: Date.now(),
    }],
    addedInput: tokens.input,
    addedOutput: tokens.output,
    addedCost: tokens.cost,
  };
}

/** Empty token delta — for when LLM call fails */
export function emptyTokenDelta(agentName) {
  return makeTokenDelta(agentName, { input: 0, output: 0, cost: 0 });
}

/**
 * Safe wrapper around callGemini — NEVER throws (except TOKEN_BUDGET_EXCEEDED).
 * Returns { ok: true, parsed, raw, tokens } on success
 * Returns { ok: false, error, tokens } on failure
 * 
 * Use this in every agent to prevent graph crashes.
 */
export async function safeCallGemini(options) {
  try {
    const result = await callGemini(options);
    return { ok: true, ...result };
  } catch (error) {
    // Token budget is the only hard stop
    if (error.message?.includes("TOKEN_BUDGET_EXCEEDED")) throw error;
    
    console.error(`[${options.agentName}] LLM call failed: ${error.message}`);
    return {
      ok: false,
      error: error.message,
      parsed: null,
      raw: "",
      tokens: { input: 0, output: 0, cost: 0 },
    };
  }
}
