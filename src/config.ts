export const OLLAMA_BASE: string =
  (typeof localStorage !== 'undefined' && (localStorage.getItem('ollamaBase') || '')) ||
  (import.meta as any).env?.VITE_OLLAMA_BASE ||
  'http://localhost:11434';

export function setOllamaBase(url: string){
  try{ localStorage.setItem('ollamaBase', url) }catch{}
}
