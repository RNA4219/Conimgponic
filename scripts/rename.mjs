
#!/usr/bin/env node
// Safe renamer: Imgponic -> Conimgponic (+ package.json & manifest tweaks)
// Usage: node scripts/rename.mjs /path/to/project
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2] || process.cwd()
const files = []
function walk(dir){
  for (const name of fs.readdirSync(dir)){
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()){
      // skip node_modules/dist/.git
      if (['node_modules','.git','dist','build','.next'].includes(name)) continue
      walk(p)
    } else {
      if (/\.(md|tsx?|html|json|css|yml|yaml|webmanifest)$/.test(name)) files.push(p)
    }
  }
}
walk(root)

function replaceInFile(p){
  let s = fs.readFileSync(p, 'utf8')
  let t = s

  // UI display
  t = t.replace(/\bImgponic\b/g, 'Conimgponic')

  // package.json name field
  if (p.endsWith('package.json')){
    try{
      const j = JSON.parse(s)
      if (typeof j.name === 'string' && j.name.toLowerCase().includes('imgponic')){
        j.name = j.name.toLowerCase().replace('imgponic', 'conimgponic')
      }
      s = JSON.stringify(j, null, 2) + '\n'
      t = s
    }catch{ /* ignore */ }
  }

  // manifest
  if (p.endsWith('manifest.webmanifest') || p.endsWith('.webmanifest')){
    try{
      const j = JSON.parse(s)
      if (j.name) j.name = 'Conimgponic'
      if (j.short_name) j.short_name = 'Conimg'
      t = JSON.stringify(j, null, 2) + '\n'
    }catch{ /* ignore */ }
  }

  // HTML title
  if (p.endsWith('index.html')){
    t = t.replace(/<title>Imgponic/g, '<title>Conimgponic')
  }

  if (t !== s){
    fs.writeFileSync(p, t, 'utf8')
    console.log('updated:', path.relative(root, p))
  }
}

for (const p of files) replaceInFile(p)

console.log('\nDone. Review changes via git diff.')
