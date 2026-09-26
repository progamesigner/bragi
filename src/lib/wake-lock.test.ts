import { describe, expect, it, vi } from "vitest";
import { ScreenWakeLock } from "./wake-lock";

function fakeHost() {
  const sentinels: { released: boolean; release: () => Promise<void> }[] = [];
  const document = { visibilityState: "visible" as DocumentVisibilityState };
  const request = vi.fn(async () => {
    const sentinel = {
      released: false,
      async release() {
        sentinel.released = true;
      },
    };
    sentinels.push(sentinel);
    return sentinel as unknown as WakeLockSentinel;
  });
  return { host: { navigator: { wakeLock: { request } }, document }, request, sentinels, document };
}

describe("screen wake lock", () => {
  it("reports missing support without requesting a lock", async () => {
    const lock = new ScreenWakeLock({ navigator: {}, document: { visibilityState: "visible" } });
    expect(lock.supported).toBe(false);
    await lock.enable();
    expect(lock.active).toBe(false);
  });

  it("reacquires after the browser releases the lock for a hidden page", async () => {
    const { host, request, sentinels, document } = fakeHost();
    const lock = new ScreenWakeLock(host);
    await lock.enable();
    expect(lock.active).toBe(true);

    document.visibilityState = "hidden";
    await sentinels[0]?.release();
    await lock.reacquire();
    expect(request).toHaveBeenCalledTimes(1);

    document.visibilityState = "visible";
    await lock.reacquire();
    expect(request).toHaveBeenCalledTimes(2);
    expect(lock.active).toBe(true);
  });

  it("releases the lock and stops reacquiring once disabled", async () => {
    const { host, request, sentinels } = fakeHost();
    const lock = new ScreenWakeLock(host);
    await lock.enable();
    await lock.disable();
    expect(sentinels[0]?.released).toBe(true);
    await lock.reacquire();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases a lock granted after it was disabled", async () => {
    const { host, sentinels } = fakeHost();
    const lock = new ScreenWakeLock(host);
    const enabling = lock.enable();
    const disabling = lock.disable();
    await Promise.all([enabling, disabling]);
    expect(sentinels[0]?.released).toBe(true);
    expect(lock.active).toBe(false);
  });
});
