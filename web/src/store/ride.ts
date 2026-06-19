import { create } from "zustand";
import type { Rider } from "../types";

export type Status = "idle" | "connecting" | "connected" | "reconnecting";

interface RideStore {
  name: string;
  code: string | null; // null = in the lobby; set = riding
  selfId: string | null; // our server-assigned id (from the `welcome` message)
  status: Status;
  riders: Rider[];

  setName: (name: string) => void;
  startRide: (code: string) => void;
  leaveRide: () => void;
  setStatus: (status: Status) => void;
  setSelfId: (id: string) => void;
  setRiders: (riders: Rider[]) => void;
}

export const useRideStore = create<RideStore>((set) => ({
  name: "",
  code: null,
  selfId: null,
  status: "idle",
  riders: [],

  setName: (name) => set({ name }),
  startRide: (code) => set({ code: code.toUpperCase(), status: "connecting", riders: [] }),
  leaveRide: () => set({ code: null, selfId: null, status: "idle", riders: [] }),
  setStatus: (status) => set({ status }),
  setSelfId: (selfId) => set({ selfId }),
  setRiders: (riders) => set({ riders }),
}));
