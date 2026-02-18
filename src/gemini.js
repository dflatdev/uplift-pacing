const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.EXPO_PUBLIC_GEMINI_MODEL ?? 'gemini-2.5-flash';

const buildPrompt = (date, userText) => `
You are the evening check-in assistant for Uplift, an app helping people with chronic fatigue and ME/CFS manage energy and avoid PEM.
Return ONLY valid JSON in the exact format below. Use the provided date in the "date" field.

Format:
{
  "date": "YYYY-MM-DD",
  "activities": [
    {
      "name": "brief activity name",
      "effort": [
        { "category": "physical|cognitive|social|sensory|emotional", "color": "green|yellow|red" }
      ],
      "duration_minutes": null,
      "difficulty_noted": false,
      "notes": "any relevant context"
    }
  ],
  "crash": { "occurred": false, "severity": null, "description": null },
  "warning_flags": [
    {
      "type": "pushed_through|delayed_onset|good_day_overexertion|cumulative_load|ignored_signals|rushed|symptom_increase",
      "severity": "high|medium|low",
      "description": "brief explanation of the concern",
      "related_activities": ["activity names"]
    }
  ],
  "energy_balance": {
    "assessment": "surplus|balanced|slight_deficit|moderate_deficit|significant_deficit",
    "current_state": "brief description of how they seem now",
    "recovery_needed": true
  },
  "supportive_message": "1-2 sentence personalized, encouraging message"
}

Date: ${date}
User summary: ${userText}
[GENERATE_SUMMARY]
`.trim();

const extractJson = (text) => {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('Gemini response did not include JSON.');
  }
  const jsonText = text.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonText);
};

export const generateNightlySummary = async ({ date, userText }) => {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing EXPO_PUBLIC_GEMINI_API_KEY.');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildPrompt(date, userText) }],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const responseText =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('') ?? '';

  if (!responseText) {
    throw new Error('Gemini API returned an empty response.');
  }

  return extractJson(responseText);
};
