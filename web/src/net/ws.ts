import { useCallback, useEffect, useRef } from "react";
import { wsBase } from "./config";
import { useRideStore } from "../store/ride";
import type { LocMsg, ServerMsg } from "../types";

// useRideSocket owns the single WebSocket to the Go server for the active ride.
// It reconnects with exponential backoff (mobile networks drop — CLAUDE.md), routes
// `welcome`/`state` into the store, and returns a sendLoc() the location hook calls ~1×/sec.
export function useRideSocket(): { sendLoc: (lat: number, lng: number, heading: number, speed: number) => void } {
  const code = useRideStore((s) => s.code);
  const name = useRideStore((s) => s.name);

  const sockRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!code) return;
    closedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const url = `${wsBase}/ws?ride=${encodeURIComponent(code)}&name=${encodeURIComponent(name || "rider")}`;
      useRideStore.getState().setStatus(retryRef.current === 0 ? "connecting" : "reconnecting");

      const ws = new WebSocket(url);
      sockRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        useRideStore.getState().setStatus("connected");
      };

      ws.onmessage = (e) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(e.data as string) as ServerMsg;
        } catch {
          return;
        }
        if (msg.type === "welcome") useRideStore.getState().setSelfId(msg.id);
        else if (msg.type === "state") useRideStore.getState().setRiders(msg.riders);
      };

      ws.onerror = () => ws.close();

      ws.onclose = () => {
        sockRef.current = null;
        if (closedRef.current) return; // we asked to leave — don't reconnect
        const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
        retryRef.current += 1;
        useRideStore.getState().setStatus("reconnecting");
        timer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      if (timer) clearTimeout(timer);
      sockRef.current?.close();
      sockRef.current = null;
    };
  }, [code, name]);

  const sendLoc = useCallback((lat: number, lng: number, heading: number, speed: number) => {
    const ws = sockRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg: LocMsg = { type: "loc", lat, lng, heading, speed, ts: Math.floor(Date.now() / 1000) };
    ws.send(JSON.stringify(msg));
  }, []);

  return { sendLoc };
}
