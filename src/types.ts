export type SceneId = string

export type AssetRef = {
  id: string
  kind: 'character'|'prop'|'background'
  label: string
  prompt?: string
  meta?: Record<string, unknown>
}

export type Scene = {
  id: SceneId
  manual: string
  ai: string
  status: 'idle'|'generating'|'error'|'dirty'
  lock?: 'manual'|'ai'|null
  seed?: number
  tone?: string
  rating?: 1|2|3|4|5
  assets: AssetRef[]
  notes?: string
  meta?: Record<string, unknown>
  shot?: string
  take?: number
  slate?: string
}

export type Tokens = Record<string,string>

export type Storyboard = {
  id: string
  title: string
  scenes: Scene[]
  selection: SceneId[]
  version: number
  tokens?: Tokens
  assetsCatalog?: AssetRef[]
}

export type CompileConfig = {
  preference: 'manual-first'|'ai-first'|'diff-merge'
  templatePath?: string
  includeNotes?: boolean
  output: ('md'|'csv'|'jsonl')[]
}
