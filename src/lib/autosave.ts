
export interface AutoSaveStorage {
  write(key: string, value: string): Promise<void>;
}

export interface AutoSaveConfig {
  maxRetries: number;
  retryBackoffMs: number;
  storage?: AutoSaveStorage;
}

export class AutoSave {
  private config: AutoSaveConfig;
  private storage: AutoSaveStorage;

  constructor(config: AutoSaveConfig) {
    this.config = config;
    this.storage = config.storage || new InMemoryAutoSaveStorage();
  }

  async save(key: string, value: string): Promise<void> {
    let retries = 0;
    while (retries <= this.config.maxRetries) {
      try {
        await this.storage.write(key, value);
        return;
      } catch (error) {
        retries++;
        if (retries > this.config.maxRetries) {
          throw error; // Max retries reached, re-throw the error
        }
        await new Promise(resolve => setTimeout(resolve, this.config.retryBackoffMs));
      }
    }
  }
}

class InMemoryAutoSaveStorage implements AutoSaveStorage {
  private data: Map<string, string> = new Map();

  async write(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  // For testing purposes
  get(key: string): string | undefined {
    return this.data.get(key);
  }
}
