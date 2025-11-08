import { AutoSave } from "../src/lib/autosave";

class FlakyStorage {
  private failCount = 0;
  constructor(private failUntil: number) {}

  async write(_k: string, _v: string): Promise<void> {
    this.failCount++;
    if (this.failCount <= this.failUntil) {
      return Promise.reject(new Error("write failed"));
    }
    return Promise.resolve();
  }
}

describe("AutoSave", () => {
  test("retries until success and succeeds", async () => {
    const storage = new FlakyStorage(2);
    const as = new AutoSave({ maxRetries: 5, retryBackoffMs: 0, storage: storage as any });
    await expect(as.save("k","v")).resolves.toBeUndefined();
  });

  test("fails after max retries", async () => {
    const storage = new FlakyStorage(10);
    const as = new AutoSave({ maxRetries: 2, retryBackoffMs: 0, storage: storage as any });
    await expect(as.save("k","v")).rejects.toThrow();
  });
});
