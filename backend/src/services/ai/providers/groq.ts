import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { ServiceUnavailableError } from '../../../lib/errors.js';
import { buildSystemPrompt, buildUserPrompt, extractJson } from '../prompt.js';
import { aiIntentSchema, type AiContext, type AiIntent, type AiProvider } from '../types.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 20_000;

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export function createGroqProvider(): AiProvider {
  const model = env.aiModel;

  return {
    name: 'groq',
    model,
    async interpret(prompt: string, context: AiContext): Promise<AiIntent> {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + env.AI_API_KEY,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 512,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: buildSystemPrompt(context) },
              { role: 'user', content: buildUserPrompt(prompt) },
            ],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        logger.error('Groq request failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        throw new ServiceUnavailableError(
          'The AI service is temporarily unavailable. You can still manage seating manually.',
          'AI_UNAVAILABLE',
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        logger.error('Groq returned an error status', { status: response.status, body: body.slice(0, 500) });
        throw new ServiceUnavailableError(
          response.status === 429
            ? 'The AI provider is rate limiting us right now. Please try again in a moment.'
            : 'The AI service is temporarily unavailable. You can still manage seating manually.',
          'AI_UNAVAILABLE',
        );
      }

      const payload = (await response.json()) as GroqResponse;
      const text = payload.choices?.[0]?.message?.content ?? '';

      if (!text.trim()) {
        throw new ServiceUnavailableError(
          'The AI service could not process that request. Please rephrase it or manage the seat manually.',
          'AI_EMPTY_RESPONSE',
        );
      }

      return aiIntentSchema.parse(extractJson(text));
    },
  };
}
