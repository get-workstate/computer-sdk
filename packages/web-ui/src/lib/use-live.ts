import { useEffect, useRef, useState } from "react";
import { wsUrl, type RunRecord } from "./api";

export interface LiveFrame {
  src: string;
  width: number;
  height: number;
  url: string;
  title: string;
}

export function useLive(envName: string) {
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [connected, setConnected] = useState(false);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState("idle");
  const socketRef = useRef<WebSocket | null>(null);
  const sendRef = useRef<(message: unknown) => void>(() => undefined);

  useEffect(() => {
    const socket = new WebSocket(wsUrl(`/ws/live/${encodeURIComponent(envName)}`));
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setError("Live connection failed.");
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        data?: string;
        width?: number;
        height?: number;
        url?: string;
        title?: string;
        run?: RunRecord | null;
        session?: string;
        message?: string;
      };
      if (message.run) setRun(message.run);
      if (message.type === "frame" && message.data) {
        setFrame({
          src: `data:image/jpeg;base64,${message.data}`,
          width: message.width ?? 1280,
          height: message.height ?? 800,
          url: message.url ?? "",
          title: message.title ?? "",
        });
        setError(null);
      } else if (message.type === "status") {
        setSession(message.session ?? "starting");
      } else if (message.type === "error" && message.message) {
        setError(message.message);
      }
    };
    return () => socket.close();
  }, [envName]);

  sendRef.current = (message: unknown) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  return {
    frame,
    connected,
    run,
    error,
    session,
    send: (message: unknown) => sendRef.current(message),
  };
}
