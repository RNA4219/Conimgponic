export async function getRoot(){
  const root = await (navigator as any).storage.getDirectory?.()
  if (!root) throw new Error('OPFS not supported in this browser')
  return root
}

export async function ensureDir(path: string){
  const root = await getRoot()
  const segs = path.split('/').filter(Boolean)
  let dir = root
  for (let i=0;i<segs.length;i++){
    dir = await dir.getDirectoryHandle(segs[i], { create: true })
  }
  return dir
}

export async function saveText(path: string, content: string){
  const segs = path.split('/').filter(Boolean)
  const fileName = segs.pop()!
  const dirPath = segs.join('/')
  const dir = await ensureDir(dirPath)
  const file = await dir.getFileHandle(fileName, { create: true })
  const w = await file.createWritable()
  await w.write(content)
  await w.close()
}

export async function loadText(path: string): Promise<string|null>{
  try{
    const root = await getRoot()
    const segs = path.split('/').filter(Boolean)
    const fileName = segs.pop()!
    let dir = root
    for (const s of segs){ dir = await dir.getDirectoryHandle(s, { create: false }) }
    const file = await dir.getFileHandle(fileName, { create: false })
    const blob = await file.getFile()
    return await blob.text()
  }catch{ return null }
}

export async function saveJSON(path: string, data: any){
  await saveText(path, JSON.stringify(data, null, 2))
}

export async function loadJSON(path: string): Promise<any|null>{
  const t = await loadText(path)
  if (t==null) return null
  try{ return JSON.parse(t) }catch{ return null }
}

export async function listDir(path: string): Promise<string[]>{ // names only
  const dir = await ensureDir(path)
  const out: string[] = []
  // @ts-ignore
  for await (const [name, handle] of (dir as any).entries()){
    out.push(String(name))
  }
  return out
}
