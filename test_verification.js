import { readFileSync } from 'node:fs';

// Read the content of IMPLEMENTATION-PLAN.md
const content = readFileSync('C:\\Users\\ryo-n\\AppData\\Local\\Temp\\vibe-kanban\\worktrees\\2b36-\\docs\\IMPLEMENTATION-PLAN.md', 'utf-8');

// Define the updated pattern from the test file
const CHECKLIST_PATTERN =
  /- \[x\] `Collector` へのテレメトリ送信がフラグ ON\/OFF 双方で同一スキーマ（JSONL）を維持する統合テスト。 \((?<date>\d{4}-\d{2}-\d{2}), \[検証ログ: tests\/platform\/vscode\/autosave\/autosave\.responsibility\.test\.ts\]\(\.\.\/tests\/platform\/vscode\/autosave\/autosave\.responsibility\.test\.ts\)\)/;

// Test if the pattern matches the content
const match = CHECKLIST_PATTERN.exec(content);

if (match) {
  console.log('✅ Pattern matches successfully');
  console.log('Matched content:', match[0]);
  const { date } = match.groups ?? {};
  console.log('Date found:', date);
  
  // Validate date format
  const parsed = Number.isNaN(Date.parse(`${date}T00:00:00Z`));
  if (!parsed) {
    console.log('✅ Date format is valid ISO8601');
  } else {
    console.log('❌ Date format is invalid');
  }
} else {
  console.log('❌ Pattern does not match content');
  // Find what's actually there to debug
  const currentPattern = /- \[x\] `Collector`.+?tests\/.+?\.test\.ts\)/g;
  const currentMatches = content.match(currentPattern);
  if (currentMatches) {
    console.log('Current matches found:', currentMatches);
  }
}