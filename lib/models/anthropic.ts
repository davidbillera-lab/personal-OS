import Anthropic from '@anthropic-ai/sdk'

export type AdapterResponse = { text: string; tokens_in: number; tokens_out: number }

let _client: Anthropic | null = null
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

export async function callAnthropic(
  prompt: string,
  model: string,
  options?: { system?: string }
): Promise<AdapterResponse> {
  const response = await client().messages.create({
    model,
    max_tokens: 1024,
    system: options?.system,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')

  return {
    text,
    tokens_in: response.usage.input_tokens,
    tokens_out: response.usage.output_tokens,
  }
}
