import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface LicenseEntry {
  readonly name: string
  readonly version: string
  readonly license: string
}

export interface LicenseFinding extends LicenseEntry {
  readonly expression: string
}

export interface LicenseCheckSummary {
  readonly ok: boolean
  readonly retryable: false
  readonly disallowed: readonly LicenseFinding[]
  readonly licenseCounts: Readonly<Record<string, number>>
  readonly totalPackages: number
}

export interface LicenseCheckResult extends LicenseCheckSummary {
  readonly reportPath: string
  readonly summaryPath: string
  readonly error?: string
}

export const DEFAULT_LICENSE_ALLOWLIST = new Set<string>([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
  'Unlicense',
])

const REPORT_FILENAME = 'license-report.json'
const SUMMARY_FILENAME = 'license-summary.json'

function isMainModule(): boolean {
  const candidate = process.argv[1]
  if (!candidate || candidate.startsWith('-')) return false
  try {
    return pathToFileURL(candidate).href === import.meta.url
  } catch (error) {
    if (error instanceof TypeError) return false
    throw error
  }
}

function collectTokens(expression: string): string[] {
  const normalized = expression.replace(/[()]/g, ' ')
  const split = normalized
    .split(/(?:\s+(?:OR|AND)\s+|\s*\+\s*|\s*\/\s*|,)/gi)
    .map((token) => token.trim())
    .filter(Boolean)

  return split.length > 0 ? split : [expression.trim()]
}

function dedupe(entries: Iterable<LicenseEntry>): LicenseEntry[] {
  const result = new Map<string, LicenseEntry>()
  for (const entry of entries) {
    result.set(`${entry.name}@${entry.version}`, entry)
  }
  return [...result.values()]
}

export function analyzeLicenses(
  entries: readonly LicenseEntry[],
  allowlist: ReadonlySet<string> = DEFAULT_LICENSE_ALLOWLIST,
): LicenseCheckSummary {
  const counts = new Map<string, number>()
  const disallowed: LicenseFinding[] = []

  for (const entry of entries) {
    const tokens = collectTokens(entry.license)
    for (const token of tokens) {
      const license = token || entry.license
      counts.set(license, (counts.get(license) ?? 0) + 1)
      if (!allowlist.has(license)) {
        disallowed.push({ ...entry, license, expression: entry.license })
      }
    }
  }

  const licenseCounts = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)))

  return {
    ok: disallowed.length === 0,
    retryable: false,
    disallowed,
    licenseCounts,
    totalPackages: entries.length,
  }
}

async function readLicensesFromPnpm(): Promise<LicenseEntry[]> {
  const { stdout } = await execFileAsync('pnpm', ['licenses', 'list', '--json'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })

  const parsed = JSON.parse(stdout) as unknown

  const flattened = flattenLicenseReport(parsed)
  return dedupe(flattened)
}

function flattenLicenseReport(node: unknown): LicenseEntry[] {
  if (!node) return []
  const stack: unknown[] = [node]
  const entries: LicenseEntry[] = []
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    if (Array.isArray(current)) {
      stack.push(...current)
      continue
    }
    if (typeof current === 'object') {
      const record = current as Record<string, unknown>
      const name = typeof record.name === 'string' ? record.name : undefined
      const version = typeof record.version === 'string' ? record.version : undefined
      const license = typeof record.license === 'string' ? record.license : undefined
      if (name && version && license) {
        entries.push({ name, version, license })
      }
      for (const value of Object.values(record)) {
        if (value && (typeof value === 'object' || Array.isArray(value))) {
          stack.push(value)
        }
      }
    }
  }
  return entries
}

export async function runLicenseCheck(): Promise<LicenseCheckResult> {
  const cwd = process.cwd()
  const reportPath = resolve(cwd, REPORT_FILENAME)
  const summaryPath = resolve(cwd, SUMMARY_FILENAME)

  const entries = await readLicensesFromPnpm()
  const summary = analyzeLicenses(entries)

  await writeFile(reportPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  return {
    ...summary,
    reportPath,
    summaryPath,
  }
}

function formatError(error: unknown): LicenseCheckResult {
  const message = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    retryable: false,
    disallowed: [],
    licenseCounts: {},
    totalPackages: 0,
    reportPath: resolve(process.cwd(), REPORT_FILENAME),
    summaryPath: resolve(process.cwd(), SUMMARY_FILENAME),
    error: message,
  }
}

async function main(): Promise<void> {
  try {
    const result = await runLicenseCheck()
    const output = JSON.stringify(result, null, 2)
    process.stdout.write(`${output}\n`)
    process.exitCode = result.ok ? 0 : 1
  } catch (error) {
    const failure = formatError(error)
    const payload = JSON.stringify(failure, null, 2)
    await Promise.all([
      writeFile(failure.reportPath, '[]\n', { encoding: 'utf8' }).catch(() => undefined),
      writeFile(failure.summaryPath, `${payload}\n`, { encoding: 'utf8' }).catch(() => undefined),
    ])
    process.stderr.write(`${payload}\n`)
    process.exitCode = 1
  }
}

if (isMainModule()) {
  void main()
}
