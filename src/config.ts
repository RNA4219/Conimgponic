type OllamaImportMeta = ImportMeta & {
  readonly env?: {
    readonly VITE_OLLAMA_BASE?: string;
  };
};

const { env } = import.meta as OllamaImportMeta;

export const OLLAMA_BASE: string =
  (typeof localStorage !== 'undefined' && (localStorage.getItem('ollamaBase') || '')) ||
  env?.VITE_OLLAMA_BASE ||
  'http://localhost:11434';

export * from './config/index';

export function setOllamaBase(url: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem('ollamaBase', url);
  } catch {
    // localStorage may be unavailable; ignore persistence errors.
    return;
  }
}
