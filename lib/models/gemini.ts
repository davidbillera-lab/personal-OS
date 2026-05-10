import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AdapterResponse } from './anthropic'

let _client: GoogleGenerativeAI | null = null
function client() {
  if (!_client) _client = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!)
  return _client
}

export async function callGemini(
  prompt: string,
  model: string,
  options?: { system?: string }
): Promise<AdapterResponse> {
  const genModel = client().getGenerativeModel({
    model,
    systemInstruction: options?.system,
  })

  const result = await genModel.generateContent(prompt)
  const response = result.response
  const usage = response.usageMetadata

  return {
    text: response.text(),
    tokens_in: usage?.promptTokenCount ?? 0,
    tokens_out: usage?.candidatesTokenCount ?? 0,
  }
}
