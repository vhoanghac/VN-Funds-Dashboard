import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Architectural guard for GRAND_PLAN 1.1: src/utils/ is the calculation core and
// must stay free of UI framework imports, so it survives a framework change.
// Today it already is; this test is what keeps it that way.

const UTILS_DIR = join(__dirname)

// Bare package names and their subpaths ('react-dom/client'), plus relative
// imports of components ('../components/Foo').
const BANNED = [/^react(-dom)?(\/|$)/, /^recharts(\/|$)/, /\.tsx$/]

const IMPORT_SOURCE = /(?:^|\s)(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g

function sourceFiles(): string[] {
  return readdirSync(UTILS_DIR).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  )
}

function importsOf(fileName: string): string[] {
  const code = readFileSync(join(UTILS_DIR, fileName), 'utf8')
  const found: string[] = []
  for (const match of code.matchAll(IMPORT_SOURCE)) {
    const source = match[1] ?? match[2] ?? match[3]
    if (source) found.push(source)
  }
  return found
}

describe('core purity: src/utils must not depend on the UI layer', () => {
  it('finds source files to check (guards against a silently empty scan)', () => {
    expect(sourceFiles().length).toBeGreaterThan(5)
  })

  it.each(sourceFiles())('%s imports nothing from React or Recharts', (fileName) => {
    const offenders = importsOf(fileName).filter((source) =>
      BANNED.some((pattern) => pattern.test(source)),
    )
    // Message names the import so a failure says what to move, not just where.
    expect(offenders, `${fileName} imports UI code: ${offenders.join(', ')}`).toEqual([])
  })
})
