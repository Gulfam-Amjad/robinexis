import { Room, RoomEvent } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import { waitForAgent } from "./CostSaverCall";

function fakeRoom(remoteCount = 0) {
  const listeners = new Map<RoomEvent, () => void>();
  return {
    remoteParticipants: new Map(
      Array.from({ length: remoteCount }, (_, index) => [String(index), {}]),
    ),
    on: vi.fn((event: RoomEvent, listener: () => void) => {
      listeners.set(event, listener);
    }),
    off: vi.fn((event: RoomEvent, listener: () => void) => {
      if (listeners.get(event) === listener) listeners.delete(event);
    }),
    join: () => listeners.get(RoomEvent.ParticipantConnected)?.(),
    disconnect: () => listeners.get(RoomEvent.Disconnected)?.(),
  };
}

describe("Cost Saver agent startup", () => {
  it("resolves immediately when the worker participant already joined", async () => {
    const room = fakeRoom(1);
    await expect(waitForAgent(room as unknown as Room, 10)).resolves.toBeUndefined();
    expect(room.on).not.toHaveBeenCalled();
  });

  it("waits for the worker and rejects bounded silent sessions", async () => {
    const joiningRoom = fakeRoom();
    const joined = waitForAgent(joiningRoom as unknown as Room, 100);
    joiningRoom.join();
    await expect(joined).resolves.toBeUndefined();

    const disconnectedRoom = fakeRoom();
    const disconnected = waitForAgent(disconnectedRoom as unknown as Room, 100);
    const disconnectedRejection = expect(disconnected).rejects.toThrow("cost_saver_connection_ended");
    disconnectedRoom.disconnect();
    await disconnectedRejection;

    vi.useFakeTimers();
    try {
      const silentRoom = fakeRoom();
      const timedOut = waitForAgent(silentRoom as unknown as Room, 20);
      const rejection = expect(timedOut).rejects.toThrow("cost_saver_agent_unavailable");
      await vi.advanceTimersByTimeAsync(20);
      await rejection;
      expect(silentRoom.off).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
