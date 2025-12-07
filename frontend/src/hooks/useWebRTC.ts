import { useRef, useState } from "react";

export interface UseWebRTCOptions {
  onFileProgress?: (fileName: string, percent: number) => void;
  onFileReceived?: (file: File) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onFileReceiveRequest?: (info: {
    filename: string;
    size: number;
    accept: () => void;
    reject: () => void;
  }) => void;
}

export function useWebRTC(
  sendSignal: (msg: any) => void,
  channelName: string,
  options?: UseWebRTCOptions
) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const receiveBufferRef = useRef<BlobPart[]>([]);
  const [receivingSize, setReceivingSize] = useState(0);
  const [currentFileName, setCurrentFileName] = useState<string>("");

  const pendingSendFileRef = useRef<File | null>(null);

  // ==================== HELPERS ====================

  const waitForChannelOpen = async (channel: RTCDataChannel) => {
    if (channel.readyState === "open") return;
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("DataChannel open timeout"));
      }, 10000);

      const listener = () => {
        clearTimeout(timeout);
        channel.removeEventListener("open", listener);
        resolve();
      };
      channel.addEventListener("open", listener);
    });
  };

  const setupDataChannel = (channel: RTCDataChannel) => {
    channel.binaryType = "arraybuffer";

    channel.onopen = () => {
      console.log("✅ [DataChannel] OPEN");
    };

    channel.onclose = () => {
      console.log("❌ [DataChannel] CLOSED");
    };

    channel.onerror = (e) => {
      console.error("⚠️ [DataChannel] ERROR", e);
    };

    channel.onmessage = (e: MessageEvent<any>) => {
      if (typeof e.data === "string") {
        const msg = JSON.parse(e.data);

        switch (msg.type) {
          case "file-info-request":
            console.log(
              "📨 [DataChannel] Received file-info-request:",
              msg.filename
            );
            options?.onFileReceiveRequest?.({
              filename: msg.filename,
              size: msg.size,
              accept: () => {
                console.log(
                  "✅ [DataChannel] User accepted file:",
                  msg.filename
                );
                channel.send(
                  JSON.stringify({
                    type: "file-info-accept",
                    filename: msg.filename,
                  })
                );
                receiveBufferRef.current = [];
                setReceivingSize(msg.size);
                setCurrentFileName(msg.filename);
                console.log(
                  "✅ [DataChannel] Ready to receive, buffer cleared"
                );
              },
              reject: () => {
                console.log(
                  "❌ [DataChannel] User rejected file:",
                  msg.filename
                );
                channel.send(
                  JSON.stringify({
                    type: "file-info-reject",
                    filename: msg.filename,
                  })
                );
              },
            });
            break;

          case "file-info-accept": {
            console.log("✅ [DataChannel] File accepted:", msg.filename);
            const file = pendingSendFileRef.current;
            if (!file) return;
            if (file.name === msg.filename) {
              sendChunks(file, channel);
              pendingSendFileRef.current = null;
            }
            break;
          }

          case "file-info-reject": {
            console.log("❌ [DataChannel] File rejected:", msg.filename);
            pendingSendFileRef.current = null;
            break;
          }

          case "file-complete": {
            console.log(
              "✅ [DataChannel] File transfer complete:",
              msg.filename
            );
            console.log(
              "📦 [DataChannel] Received chunks:",
              receiveBufferRef.current.length
            );
            const fileBlob = new Blob(receiveBufferRef.current);
            console.log("📦 [DataChannel] Blob size:", fileBlob.size);
            const file = new File([fileBlob], msg.filename);
            console.log("📦 [DataChannel] File created:", file.name, file.size);
            options?.onFileReceived?.(file);
            receiveBufferRef.current = [];
            setReceivingSize(0);
            setCurrentFileName("");
            break;
          }

          default:
            break;
        }

        return;
      }

      // binary chunk
      const chunk = new Uint8Array(e.data);
      receiveBufferRef.current.push(chunk);

      const total = receiveBufferRef.current.reduce(
        (sum, c) => sum + (c instanceof Uint8Array ? c.byteLength : 0),
        0
      );
      const percent =
        receivingSize > 0 ? Math.floor((total / receivingSize) * 100) : 0;

      if (percent % 10 === 0 || percent === 100) {
        console.log(
          `📊 [DataChannel] Receiving: ${currentFileName} - ${percent}% (${total}/${receivingSize} bytes)`
        );
      }

      options?.onFileProgress?.(currentFileName, percent);
    };
  };

  const sendChunks = async (file: File, channel: RTCDataChannel) => {
    console.log("📤 [sendChunks] Starting for:", file.name);
    await waitForChannelOpen(channel);

    const chunkSize = 64 * 1024;
    const buffer = await file.arrayBuffer();
    const total = buffer.byteLength;
    let offset = 0;

    while (offset < total) {
      const chunk = buffer.slice(offset, offset + chunkSize);
      channel.send(chunk);
      offset += chunkSize;
      const percent = Math.floor((offset / total) * 100);
      options?.onFileProgress?.(file.name, percent);
      await new Promise((r) => setTimeout(r, 0));
    }

    channel.send(
      JSON.stringify({ type: "file-complete", filename: file.name })
    );
    console.log("✅ [sendChunks] Complete for:", file.name);
  };

  // ==================== INIT / OFFER / ANSWER / ICE ====================

  const init = async () => {
    if (pcRef.current) {
      console.log("⚠️ [init] PC already exists");
      return pcRef.current;
    }

    console.log("🚀 [init] Creating new PeerConnection");

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log("🧊 [PC] Sending ICE candidate");
        sendSignal({
          action: "sendMessage",
          channel: channelName,
          type: "ice",
          payload: e.candidate,
        });
      } else {
        console.log("🧊 [PC] All ICE candidates sent (received null)");
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("🔌 [PC] Connection State:", pc.connectionState);
      options?.onConnectionStateChange?.(pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log("🧊 [PC] ICE Connection State:", pc.iceConnectionState);
      if (pc.iceConnectionState === "failed") {
        console.error("❌ [PC] ICE Connection FAILED - May need TURN server");
      }
    };

    pc.ondatachannel = (event) => {
      console.log("📺 [PC] Remote DataChannel received");
      setupDataChannel(event.channel);
      dataChannelRef.current = event.channel;
    };

    pcRef.current = pc;

    const channel = pc.createDataChannel("file");
    console.log(
      "📺 [PC] Local DataChannel created, state:",
      channel.readyState
    );
    setupDataChannel(channel);
    dataChannelRef.current = channel;

    return pc;
  };

  const createOffer = async () => {
    console.log("📤 [createOffer] Starting...");

    if (!pcRef.current) {
      console.error("❌ [createOffer] PC not initialized!");
      return;
    }

    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);
    console.log("✅ [createOffer] Offer created and set as local description");

    sendSignal({
      action: "sendMessage",
      channel: channelName,
      type: "offer",
      payload: offer,
    });
    console.log("✅ [createOffer] Offer sent via signaling");
  };

  const createAnswer = async (offer: RTCSessionDescriptionInit) => {
    console.log("📥 [createAnswer] Starting...");

    if (!pcRef.current) {
      console.error("❌ [createAnswer] PC not initialized!");
      return;
    }

    await pcRef.current.setRemoteDescription(offer);
    console.log("✅ [createAnswer] Remote description set");

    if (pendingIceCandidatesRef.current.length > 0) {
      console.log(
        `🧊 [createAnswer] Adding ${pendingIceCandidatesRef.current.length} pending ICE candidates`
      );
      for (const candidate of pendingIceCandidatesRef.current) {
        await pcRef.current.addIceCandidate(candidate);
      }
      pendingIceCandidatesRef.current = [];
    }

    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);
    console.log(
      "✅ [createAnswer] Answer created and set as local description"
    );

    sendSignal({
      action: "sendMessage",
      channel: channelName,
      type: "answer",
      payload: answer,
    });
    console.log("✅ [createAnswer] Answer sent via signaling");
  };

  const setRemoteAnswer = async (answer: RTCSessionDescriptionInit) => {
    console.log("📥 [setRemoteAnswer] Starting...");

    if (!pcRef.current) {
      console.error("❌ [setRemoteAnswer] PC not initialized!");
      return;
    }

    await pcRef.current.setRemoteDescription(answer);
    console.log("✅ [setRemoteAnswer] Remote description set");

    if (pendingIceCandidatesRef.current.length > 0) {
      console.log(
        `🧊 [setRemoteAnswer] Adding ${pendingIceCandidatesRef.current.length} pending ICE candidates`
      );
      for (const candidate of pendingIceCandidatesRef.current) {
        await pcRef.current.addIceCandidate(candidate);
      }
      pendingIceCandidatesRef.current = [];
    }
  };

  const addIce = async (candidate: RTCIceCandidateInit) => {
    console.log("🧊 [addIce] Adding ICE candidate");

    if (!pcRef.current) {
      console.error("❌ [addIce] PC not initialized!");
      return;
    }

    if (!pcRef.current.remoteDescription) {
      console.log(
        "⏳ [addIce] Remote description not set yet, queuing candidate"
      );
      pendingIceCandidatesRef.current.push(candidate);
      return;
    }

    try {
      await pcRef.current.addIceCandidate(candidate);
      console.log("✅ [addIce] ICE candidate added successfully");
    } catch (err) {
      console.error("❌ [addIce] Failed to add ICE candidate:", err);
    }
  };

  const sendFile = async (file: File) => {
    console.log("🚀 [sendFile] Starting, file:", file.name);

    const channel = dataChannelRef.current;
    if (!channel) {
      console.error("❌ [sendFile] DataChannel not created yet");
      return;
    }

    console.log("📡 [sendFile] Channel state:", channel.readyState);

    await waitForChannelOpen(channel);

    console.log("✅ [sendFile] Channel is open");

    pendingSendFileRef.current = file;

    const request = {
      type: "file-info-request",
      filename: file.name,
      size: file.size,
    };

    console.log("📨 [sendFile] Sending request:", request);

    channel.send(JSON.stringify(request));

    console.log("✅ [sendFile] Request sent, waiting for accept/reject...");
  };

  return {
    init,
    createOffer,
    createAnswer,
    setRemoteAnswer,
    addIce,
    sendFile,
    pc: pcRef,
    dataChannel: dataChannelRef,
  };
}
