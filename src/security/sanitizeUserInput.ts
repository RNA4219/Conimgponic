// `+` avoids zero-width matches that previously injected stray whitespace.
const UNSAFE_FRAGMENT_PATTERN = /[^\p{L}\p{N}\p{M}\p{Pc}\p{Pd}'’.,@/:+-]+/gu
const COLLAPSE_WHITESPACE_PATTERN = /\s+/gu
const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>[\s\S]*?<\/script>/giu
const HTML_TAG_PATTERN = /<[^>]+>/gu

const normalizeWhitespace = (value: string): string => {
  const collapsed = value.replace(COLLAPSE_WHITESPACE_PATTERN, ' ')
  return collapsed.trim()
}

export const sanitizeUserInput = (input: string): string => {
  if (input === '') {
    return ''
  }

  const withoutScripts = input.replace(SCRIPT_BLOCK_PATTERN, ' ')
  const withoutTags = withoutScripts.replace(HTML_TAG_PATTERN, ' ')
  const sanitized = withoutTags.replace(UNSAFE_FRAGMENT_PATTERN, ' ')
  return normalizeWhitespace(sanitized)
}
