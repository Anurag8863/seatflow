import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { ServiceUnavailableError } from '../../../lib/errors.js';
import { buildSystemPrompt, buildUserPrompt, extractJson } from '../prompt.js';
import { aiIntentSchema, type AiContext, type AiIntent, type AiProvider } from '../types.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 20_000;

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  promptFeedback?: { blockReason?: string };
}

export function createGeminiProvider(): AiProvider {
  const model = env.aiModel;

  return {
    name: 'gemini',
    model,
    async interpret(prompt: string, context: AiContext): Promise<AiIntent> {
      let response: Response;
      try {
        response = await fetch(
          ENDPOINT + '/' + encodeURIComponent(model) + ':generateContent',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              // Header rather than query string so the key never lands in a URL log.
              'x-goog-api-key': env.AI_API_KEY,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: buildSystemPrompt(context) }] },
              contents: [{ role: 'user', parts: [{ text: buildUserPrompt(prompt) }] }],
              generationConfig: {
                temperature: 0,
                maxOutputTokens: 512,
                responseMimeType: 'application/json',
              },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
      } catch (error) {
        logger.error('Gemini request failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        throw new ServiceUnavailableError(
          'The AI service is temporarily unavailable. You can still manage seating manually.',
          'AI_UNAVAILABLE',
        );
      }

      if (!response.ok) {
        // The body can echo request details, so it is logged but never returned.
        const body = await response.text().catch(() => '');
        logger.error('Gemini returned an error status', { status: response.status, body: body.slice(0, 500) });
        throw new ServiceUnavailableError(
          response.status === 429
            ? 'The AI provider is rate limiting us right now. Please try again in a moment.'
            : 'The AI service is temporarily unavailable. You can still manage seating manually.',
          'AI_UNAVAILABLE',
        );
      }

      const payload = (await response.json()) as GeminiResponse;
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';

      if (!text.trim()) {
        logger.warn('Gemini returned an empty candidate', { blockReason: payload.promptFeedback?.blockReason });
        throw new ServiceUnavailableError(
          'The AI service could not process that request. Please rephrase it or manage the seat manually.',
          'AI_EMPTY_RESPONSE',
        );
      }

      return aiIntentSchema.parse(extractJson(text));
    },
  };
}
