import type { Tokens } from '../types'

export const defaultTokens: Tokens = {
  cinematic: "cinematic tone, dynamic camera, subtle color grading",
  noir: "film noir tone, high contrast lighting, 50mm lens, smoke-filled room",
  anime: "anime storyboard style, vibrant colors, dynamic action lines"
}

export function expandTone(tone: string|undefined, text: string){
  if (!tone) return text
  const dict = defaultTokens
  const t = dict[tone] || tone
  return `[tone:${t}]\n` + text
}
