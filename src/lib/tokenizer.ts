// src/lib/tokenizer.ts
export function tokenizeForSimilarity(text: string): readonly string[] {
  return text
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length > 0)
}