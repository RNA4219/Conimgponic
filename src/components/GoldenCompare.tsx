import React, { useMemo, useState } from 'react'
import { toMarkdown } from '../lib/exporters'
import { useSB } from '../store'
import { readFileAsText } from '../lib/importers'

function normalize(s:string){
  return s.replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n').trim()
}
function score(a:string,b:string){
  const A = normalize(a), B = normalize(b)
  if (!A && !B) return 1
  const min = Math.min(A.length, B.length), max = Math.max(A.length, B.length)
  let same = 0
  for (let i=0;i<min;i++){ if (A[i]===B[i]) same++ }
  return (same / max)
}

export function GoldenCompare(){
  const { sb } = useSB()
  const [gold, setGold] = useState<string>('')
  const compiled = useMemo(()=> toMarkdown(sb), [sb])
  const sc = useMemo(()=> score(compiled, gold), [compiled, gold])

  return (
    <div style={{padding:8, display:'grid', gap:8}}>
      <div style={{display:'flex', gap:8, alignItems:'center'}}>
        <input type="file" onChange={async e=>{
          const f = e.target.files?.[0]; if (!f) return
          const t = await readFileAsText(f)
          setGold(t)
        }}/>
        <span>一致率（簡易）: {(sc*100).toFixed(1)}%</span>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
        <div><h4>Compiled (MD)</h4><pre>{compiled}</pre></div>
        <div><h4>Golden</h4><pre>{gold}</pre></div>
      </div>
    </div>
  )
}
