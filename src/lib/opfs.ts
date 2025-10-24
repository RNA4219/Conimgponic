type StorageManagerWithDirectory = StorageManager & {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>
}

type IterableFileSystemDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>
}

async function resolveRootDirectory(): Promise<FileSystemDirectoryHandle> {
  const storage = navigator.storage as StorageManagerWithDirectory
  const getDirectory = storage.getDirectory
  if (!getDirectory) {
    throw new Error('OPFS not supported in this browser')
  }
  return getDirectory.call(storage)
}

export async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return resolveRootDirectory()
}

export async function ensureDir(path: string): Promise<FileSystemDirectoryHandle> {
  const segments = path.split('/').filter(Boolean)
  let directory = await getRoot()
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true })
  }
  return directory
}

export async function saveText(path: string, content: string): Promise<void> {
  const segments = path.split('/').filter(Boolean)
  const fileName = segments.pop()
  if (!fileName) {
    throw new Error('File name missing in path')
  }
  const directoryPath = segments.join('/')
  const directory = await ensureDir(directoryPath)
  const file = await directory.getFileHandle(fileName, { create: true })
  const writable = await file.createWritable()
  await writable.write(content)
  await writable.close()
}

export async function loadText(path: string): Promise<string | null> {
  try {
    const segments = path.split('/').filter(Boolean)
    const fileName = segments.pop()
    if (!fileName) {
      return null
    }
    let directory = await getRoot()
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment, { create: false })
    }
    const file = await directory.getFileHandle(fileName, { create: false })
    const blob = await file.getFile()
    return await blob.text()
  } catch {
    return null
  }
}

export async function saveJSON<T>(path: string, data: T): Promise<void> {
  await saveText(path, JSON.stringify(data, null, 2))
}

export async function loadJSON<T>(path: string): Promise<T | null> {
  const content = await loadText(path)
  if (content == null) {
    return null
  }
  try {
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

export async function listDir(path: string): Promise<string[]> {
  const directory = await ensureDir(path)
  const iterableDirectory = directory as IterableFileSystemDirectoryHandle
  const names: string[] = []
  for await (const handle of iterableDirectory.values()) {
    if ('name' in handle) {
      names.push(handle.name)
    }
  }
  return names
}
