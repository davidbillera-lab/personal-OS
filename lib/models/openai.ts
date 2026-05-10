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
  options?: { system?: string }
): Promise<AdapterResponse> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  if (options?.system) messages.push({ role: 'system', content: options.system })
  messages.push({ role: 'user', content: prompt })

  const response = await client().chat.completions.create({ model, messages, max_tokens: 1024 })

  return {
    text: response.choices[0]?.message?.content ?? '',
    tokens_in: response.usage?.prompt_tokens ?? 0,
    tokens_out: response.usage?.completion_tokens ?? 0,
  }
}
