import type { PandaConfig } from "../ai.config.js";

export interface CompiledResponse {
  thinking: string;
  answer: string;
  totalLength: number;
  thinkingLength: number;
  answerLength: number;
}

export class R1Compiler {
  /**
   * Parses the raw R1 response into a structured output containing the thinking trace and final answer.
   */
  public static compile(raw: string): CompiledResponse {
    let thinking = "";
    let answer = raw;

    const thinkStart = raw.indexOf("<think>");
    const thinkEnd = raw.indexOf("</think>");

    if (thinkStart !== -1) {
      if (thinkEnd !== -1 && thinkEnd > thinkStart) {
        thinking = raw.substring(thinkStart + 7, thinkEnd).trim();
        answer = (raw.substring(0, thinkStart) + raw.substring(thinkEnd + 8)).trim();
      } else {
        // Unclosed think tag
        thinking = raw.substring(thinkStart + 7).trim();
        answer = raw.substring(0, thinkStart).trim();
      }
    }

    return {
      thinking,
      answer,
      totalLength: raw.length,
      thinkingLength: thinking.length,
      answerLength: answer.length,
    };
  }

  /**
   * Executes a validation critique loop against an answer using a verification model (e.g. Groq).
   */
  public static async verify(
    input: string,
    answer: string,
    config: PandaConfig
  ): Promise<{ verified: boolean; answer: string }> {
    const groqKey = config.providers.groq.api_key;
    const fastModel = config.routing.fast_path.model;

    if (!groqKey) {
      return { verified: false, answer };
    }

    try {
      const verifyPrompt = `The user asked: "${input}"

An agent proposed this answer:
${answer}

Is this answer complete, correct, and safe?
Reply EXACTLY in this format:
VERDICT: PASS (if it is correct)
VERDICT: FAIL
FIXED: <your corrected answer if it failed, otherwise leave blank>`;

      const verifyRes = await fetch(`${config.providers.groq.api_base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: fastModel,
          messages: [{ role: "user", content: verifyPrompt }],
          max_tokens: 2048,
          temperature: 0,
        }),
      });

      if (!verifyRes.ok) return { verified: false, answer };

      const verifyData = await verifyRes.json() as any;
      const responseText = verifyData.choices[0]?.message?.content ?? "";

      const passMatch = responseText.match(/VERDICT:\s*PASS/i);
      const fixedMatch = responseText.match(/FIXED:\s*([\s\S]+)/i);

      if (passMatch) {
        return { verified: true, answer };
      } else if (fixedMatch) {
        return { verified: false, answer: fixedMatch[1].trim() };
      }

      return { verified: false, answer };
    } catch {
      return { verified: false, answer };
    }
  }
}
