import { loadText, loadJSON } from './opfs'
import type { Storyboard } from '../types'

export async function buildPackage(sb: Storyboard){
  const latest = await loadText('runs/latest.txt')
  const meta = latest ? await loadJSON(`runs/${latest}/meta.json`) : null
  const out = {
    version: '1.4',
    project: sb,
    latest_run: latest || null,
    latest_meta: meta || null
  }
  return JSON.stringify(out, null, 2)
}
