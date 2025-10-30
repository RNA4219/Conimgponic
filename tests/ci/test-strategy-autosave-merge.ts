import { readFile } from 'node:fs/promises'

const COMMAND_SECTION_HEADING = '### 4.1 推奨コマンドシーケンス'
const CODE_SPAN_PATTERN = /`([^`]*pnpm[^`]*)`/g
const NEXT_HEADING_PATTERN = /\n#{2,}\s/u

export type TestStrategyExpectations = {
  qualityCommands: readonly string[]
  qualitySuites: readonly string[]
  coverageCommand: string
  junitCommand: string
}

export async function loadTestStrategyExpectations(
  strategyPath: string,
): Promise<TestStrategyExpectations> {
  const section = extractCommandSection(await readFile(strategyPath, 'utf8'))
  const qualityCommands: string[] = [], qualitySuites: string[] = []
  let coverageCommand: string | undefined, junitCommand: string | undefined

  for (const raw of extractCommandTokens(section)) {
    const canonical = canonicalizeCommand(raw)
    const suite = deriveQualitySuite(canonical)
    if (suite) {
      qualitySuites.push(suite)
      qualityCommands.push(canonical)
      continue
    }
    if (!coverageCommand && canonical === 'pnpm -s test:coverage') {
      coverageCommand = canonical
      continue
    }
    if (!junitCommand && canonical.startsWith('pnpm test --test-reporter=')) {
      junitCommand = canonical
    }
  }

  if (qualityCommands.length === 0) {
    throw new Error('Test strategy did not provide any quality commands')
  }
  if (!coverageCommand) {
    throw new Error('Test strategy did not provide coverage command')
  }
  if (!junitCommand) {
    throw new Error('Test strategy did not provide JUnit command')
  }

  return { qualityCommands, qualitySuites, coverageCommand, junitCommand }
}

function extractCommandSection(markdown: string): string {
  const start = markdown.indexOf(COMMAND_SECTION_HEADING)
  if (start === -1) {
    throw new Error(`Test strategy is missing heading: ${COMMAND_SECTION_HEADING}`)
  }
  const afterHeading = markdown.slice(start + COMMAND_SECTION_HEADING.length)
  const end = afterHeading.search(NEXT_HEADING_PATTERN)
  return end === -1 ? afterHeading : afterHeading.slice(0, end)
}

function extractCommandTokens(section: string): string[] {
  const commands: string[] = []
  let match: RegExpExecArray | null
  while ((match = CODE_SPAN_PATTERN.exec(section)) !== null) {
    for (const segment of splitSegments(match[1])) {
      if (segment.includes('pnpm')) {
        commands.push(segment.replace(/\s+/g, ' ').trim())
      }
    }
  }
  return commands
}

function splitSegments(input: string): string[] {
  const segments: string[] = []
  for (const arrowPart of input.split('→')) {
    for (const slashPart of arrowPart.split(/\s+\/\s+/u)) {
      for (const andPart of slashPart.split('&&')) {
        const trimmed = andPart.trim()
        if (trimmed) {
          segments.push(trimmed)
        }
      }
    }
  }
  return segments
}

function canonicalizeCommand(command: string): string {
  const normalized = command.replace(/\s+/g, ' ').trim()
  if (/^pnpm(?:\s+-s)?\s+lint$/u.test(normalized)) {
    return 'pnpm -s lint'
  }
  if (/^pnpm(?:\s+-s)?\s+typecheck$/u.test(normalized)) {
    return 'pnpm -s typecheck'
  }
  const filterMatch = normalized.match(/^pnpm(?:\s+-s)?\s+test\s+--filter\s+([\w:-]+)/u)
  if (filterMatch) {
    return `pnpm -s test:${filterMatch[1]}`
  }
  const scriptMatch = normalized.match(/^pnpm(?:\s+-s)?\s+(test:[\w:-]+)/u)
  if (scriptMatch) {
    return `pnpm -s ${scriptMatch[1]}`
  }
  return normalized.startsWith('pnpm test -- --test-reporter=')
    ? normalized.replace('test -- --', 'test --')
    : normalized
}

function deriveQualitySuite(command: string): string | null {
  if (command === 'pnpm -s lint' || command === 'pnpm -s typecheck') {
    return command.slice('pnpm -s '.length)
  }
  const match = command.match(/^pnpm -s test:([\w:-]+)/u)
  if (!match) {
    return null
  }
  const suite = match[1]
  return suite === 'coverage' ? null : suite
}
