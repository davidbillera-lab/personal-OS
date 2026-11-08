import OpenAI from 'openai'
import type { AdapterResponse } from './anthropic'

let _client: OpenAI | null = null
function client() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _client
}

export async function callOpenAI(
  prompt: string,
  model: string,
  options?: { system?: string; max_tokens?: number }
): Promise<AdapterResponse> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  if (options?.system) messages.push({ role: 'system', content: options.system })
  messages.push({ role: 'user', content: prompt })

  // gpt-5+ reasoning models reject max_tokens and spend part of the budget on reasoning.
  const limit = options?.max_tokens ?? 1024
  const tokenField = /^gpt-([5-9]|\d{2})/.test(model) ? { max_completion_tokens: limit } : { max_tokens: limit }
  const response = await client().chat.completions.create({ model, messages, ...tokenField })

  return {
    text: response.choices[0]?.message?.content ?? '',
    tokens_in: response.usage?.prompt_tokens ?? 0,
    tokens_out: response.usage?.completion_tokens ?? 0,
  }
}
