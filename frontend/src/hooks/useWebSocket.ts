import { useEffect, useRef, useState, useCallback } from "react";

export function useWebSocket(
  channel: string | null,
  onMessage?: (data: any) => void
) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Stable reference for onMessage (avoid triggering reconnect)
  const messageHandlerRef = useRef(onMessage);
  useEffect(() => {
    messageHandlerRef.current = onMessage;
  }, [onMessage]);

  // Stable send() – does NOT depend on wsRef
  const send = useCallback((msg: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log("📤 [WS] Sending:", msg.type, msg);
      ws.send(JSON.stringify(msg));
    } else {
      console.error("❌ [WS] Cannot send, not connected");
    }
  }, []);

  // Connect only when channel finalized
  useEffect(() => {
    if (!channel) return;

    console.log("🔌 [WS] Connecting to channel:", channel);
    const url = `${import.meta.env.VITE_WS_URL}?channel=${channel}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("✅ [WS] Connected");
      setConnected(true);
      // ❌ BỎ: không tự động gửi ready ở đây
      // WebSocket chỉ là transport layer, logic signaling nên ở Home.tsx
    };

    ws.onclose = () => {
      console.log("❌ [WS] Disconnected");
      setConnected(false);
    };

    ws.onerror = (e) => {
      console.error("⚠️ [WS] Error:", e);
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        console.log("📨 [WS] Received:", data.type, data);
        messageHandlerRef.current?.(data);
      } catch (err) {
        console.error("❌ [WS] Invalid message:", evt.data);
      }
    };

    return () => {
      console.log("🔌 [WS] Closing connection");
      ws.close();
    };
  }, [channel]);

  return { connected, sendMessage: send };
}