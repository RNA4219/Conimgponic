import { readFile } from 'node:fs/promises'

const COMMAND_SECTION_HEADING = '### 4.1 推奨コマンドシーケンス'
const CODE_SPAN_PATTERN = /`([^`]*pnpm[^`]*)`/g
const NEXT_HEADING_PATTERN = /\n#{2,}\s/u

export type TestStrategyExpectations = {
  qualityCommands: readonly string[]
  qualitySuites: readonly string[]
  coverageCleanup: string
  coverageCommand: string
  junitCommand: string
}

export async function loadTestStrategyExpectations(
  strategyPath: string,
): Promise<TestStrategyExpectations> {
  const section = extractCommandSection(await readFile(strategyPath, 'utf8'))
  const qualityCommands: string[] = [], qualitySuites: string[] = []
  let coverageCleanup: string | undefined
  let coverageCommand: string | undefined
  let junitCommand: string | undefined

  for (const raw of extractCommandTokens(section)) {
    const canonical = raw.includes('pnpm') ? canonicalizeCommand(raw) : raw
    if (!coverageCleanup && isCoverageCleanupCommand(canonical)) {
      coverageCleanup = canonical
      continue
    }
    if (!canonical.includes('pnpm')) {
      continue
    }

    const suite = deriveQualitySuite(canonical)
    if (suite) {
      qualitySuites.push(suite)
      qualityCommands.push(canonical)
      continue
    }
    if (!coverageCommand && isCoverageCommand(canonical)) {
      coverageCommand = canonical
      continue
    }
    if (!junitCommand && isJunitCommand(canonical)) {
      junitCommand = canonical
    }
  }

  if (qualityCommands.length === 0) {
    throw new Error('Test strategy did not provide any quality commands')
  }
  if (!coverageCleanup) {
    throw new Error('Test strategy did not provide coverage cleanup command')
  }
  if (!coverageCommand) {
    throw new Error('Test strategy did not provide coverage command')
  }
  if (!junitCommand) {
    throw new Error('Test strategy did not provide JUnit command')
  }

  return {
    qualityCommands,
    qualitySuites,
    coverageCleanup,
    coverageCommand,
    junitCommand,
  }
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
      const normalized = segment.replace(/\s+/g, ' ').trim()
      if (normalized) {
        commands.push(normalized)
      }
    }
  }
  return commands
}

function isCoverageCleanupCommand(command: string): boolean {
  return /rm\s+-rf\s+coverage/u.test(command)
}

function isCoverageCommand(command: string): boolean {
  return /pnpm(?:\s+-s)?\s+(?:test:coverage|test\s+--filter\s+coverage)/u.test(command)
}

function isJunitCommand(command: string): boolean {
  return /pnpm(?:\s+-s)?\s+test\b.*--test-reporter=junit/u.test(command)
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
