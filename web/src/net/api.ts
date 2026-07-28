import { httpBase } from "./config";

// POST /rides → { code } (docs/SETUP_BACKEND.md §6). Mints a fresh join code; the room is
// created lazily when the first rider opens the WebSocket.
export async function createRide(): Promise<string> {
  const res = await fetch(`${httpBase}/rides`, { method: "POST" });
  if (!res.ok) throw new Error(`createRide failed: ${res.status}`);
  const data = (await res.json()) as { code: string };
  return data.code;
}
