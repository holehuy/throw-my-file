// Home.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { generateChannel, sanitizeChannel } from "../utils/channel";
import { useWebSocket } from "../hooks/useWebSocket";
import { showToast } from "../utils/toast";
import { useConfirmDialog } from "../hooks/useConfirmDiaglog";
import ConfirmModal from "../components/ConfirmModal";
import { useWebRTC } from "../hooks/useWebRTC";

export default function Home() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialChannel = searchParams.get("channel") || "";

  // --- UI / feature state ---
  const [channel, setChannel] = useState<string>(initialChannel);
  const [fileProgress, setFileProgress] = useState<Record<string, number>>({});
  const [fileHistory, setFileHistory] = useState<
    { name: string; size: number; url: string }[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasJoinedRef = useRef(false);
  const isInitiatorRef = useRef(false); // Theo dõi xem peer này có phải là initiator không

  // --- confirm dialog hook ---
  const {
    open: openConfirm,
    close: closeConfirm,
    isOpen,
    options,
    onConfirm,
    onCancel,
  } = useConfirmDialog(); // ✅ Bỏ callback mặc định

  // ----------------------------
  // WebSocket hook
  // ----------------------------
  const { sendMessage, connected } = useWebSocket(channel, async (msg) => {
    console.log("📨 [WebSocket] Received:", msg.type);

    switch (msg.type) {
      case "join":
        console.log("✅ [Signaling] Someone JOINED → sending READY");
        showToast("Someone joined the channel!", "info");
        sendMessage({
          action: "sendMessage",
          channel,
          type: "ready",
          payload: { ts: Date.now() },
        });
        break;

      case "peer_joined":
        // Backend gửi peer_joined thay vì relay message "join"
        console.log("✅ [Signaling] peer_joined → sending READY");
        showToast("Someone joined the channel!", "info");
        sendMessage({
          action: "sendMessage",
          channel,
          type: "ready",
          payload: { ts: Date.now() },
        });
        break;

      case "ready":
        console.log("✅ [Signaling] Received READY → creating OFFER");
        await createOffer();
        break;

      case "offer":
        console.log("✅ [Signaling] Received OFFER → creating ANSWER");
        await createAnswer(msg.payload);
        break;

      case "answer":
        console.log(
          "✅ [Signaling] Received ANSWER → setting remote description"
        );
        if (msg.payload && pc.current) {
          await pc.current.setRemoteDescription(
            new RTCSessionDescription(msg.payload)
          );
          console.log(
            "✅ [Signaling] Remote description set - Connection should establish now"
          );
        }
        break;

      case "ice":
        console.log("✅ [Signaling] Received ICE candidate");
        if (msg.payload) {
          await addIce(msg.payload);
          console.log("✅ [Signaling] ICE candidate added");
        }
        break;

      case "peer_left":
        showToast("Someone left the channel.", "warning");
        break;

      default:
        console.warn("⚠️ [WS] Unhandled message:", msg.type);
        break;
    }
  });

  // ----------------------------
  // WebRTC hook
  // ----------------------------
  const {
    init,
    createOffer,
    createAnswer,
    addIce,
    sendFile,
    pc,
  } = useWebRTC(
    sendMessage,
    channel, // ✅ Truyền channel vào
    {
      onFileProgress: (fileName, percent) => {
        console.log(`📊 [Home] Progress: ${fileName} - ${percent}%`);
        setFileProgress((prev) => ({ ...prev, [fileName]: percent }));
      },
      onFileReceived: (file) => {
        console.log("🎉 [Home] File received!", file.name, file.size);
        const url = URL.createObjectURL(file);
        console.log("🔗 [Home] Download URL:", url);
        setFileHistory((h) => [
          { name: file.name, size: file.size, url },
          ...h,
        ]);

        // ✅ Tự động download
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        showToast(`Received ${file.name}`, "success");
      },
      onFileReceiveRequest: ({ filename, size, accept, reject }) => {
        openConfirm({
          title: "Incoming File",
          message: `Do you want to receive "${filename}" (${(
            size /
            1024 /
            1024
          ).toFixed(2)} MB)?`,
          onConfirm: () => {
            accept();
            closeConfirm();
          },
          onCancel: () => {
            reject();
            closeConfirm();
          },
        });
      },
    }
  );

  // ----------------------------
  // Auto-generate channel on first load
  // ----------------------------
  useEffect(() => {
    if (!initialChannel) {
      const newChan = generateChannel();
      navigate(`/?channel=${newChan}`, { replace: true });
      setChannel(newChan);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------
  // Auto join when WebSocket connected AND channel is set
  // ----------------------------
  useEffect(() => {
    if (!channel || !connected) {
      console.log(
        "⏳ [Auto-join] Waiting... channel:",
        channel,
        "connected:",
        connected
      );
      return;
    }

    if (hasJoinedRef.current) {
      console.log("⚠️ [Auto-join] Already joined, skipping");
      return;
    }

    hasJoinedRef.current = true;
    console.log("🚀 [Auto-join] Starting for channel:", channel);

    (async () => {
      await init();
      console.log("✅ [Auto-join] PC initialized");

      sendMessage({
        action: "sendMessage",
        channel,
        type: "join",
        payload: { ts: Date.now() },
      });

      showToast("Successfully connected.", "success");
    })();
  }, [channel, connected, init, sendMessage]);

  // ----------------------------
  // UI handlers
  // ----------------------------
  function handleJoin() {
    if (channel.length < 4) return;
    hasJoinedRef.current = false; // Reset để join lại
    isInitiatorRef.current = false; // Reset initiator flag
    navigate(`/?channel=${channel}`);
  }

  function handleRefresh() {
    const newChan = generateChannel();
    hasJoinedRef.current = false; // Reset
    isInitiatorRef.current = false; // Reset initiator flag
    navigate(`/?channel=${newChan}`);
    setChannel(newChan);
  }

  function handleCopy() {
    navigator.clipboard.writeText(channel);
    showToast("Channel copied to clipboard.", "success");
  }

  function handleShare() {
    navigator.clipboard.writeText(window.location.href);
    showToast("Channel URL copied to clipboard.", "success");
  }

  // ----------------------------
  // File input change -> send files via useWebRTC
  // ----------------------------
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    console.log("🔥 handleFileSelected triggered");

    const files = e.target.files;
    console.log("📁 files:", files);
    console.log("📁 files?.length:", files?.length);

    if (!files || files.length === 0) {
      console.log("❌ No files - EARLY RETURN");
      return;
    }

    console.log("✅ Files found, proceeding...");

    // ensure peer connection exists (init)
    await init();

    // If sendFile expects File (not FileList), call for each
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      console.log(`📤 Sending file ${i + 1}/${files.length}: ${f.name}`);
      try {
        await sendFile(f);
        const url = URL.createObjectURL(f);
        setFileHistory((h) => [{ name: f.name, size: f.size, url }, ...h]);
        showToast(`Sent ${f.name} successfully`, "success");
      } catch (err) {
        console.error("Failed to send file", err);
        showToast("Failed to send file", "error");
      }
    }

    // reset input so selecting same file again will trigger change
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFileProgress({});
  }

  // ----------------------------
  // Render
  // ----------------------------
  return (
    <div className="container py-5 d-flex justify-content-center">
      <div
        className="card shadow p-4"
        style={{ maxWidth: "480px", width: "100%", borderRadius: "16px" }}
      >
        {/* Header */}
        <div className="text-left">
          <h3 className="text-start fw-bold text-primary fs-4">
            Unleash the Power of Connectivity!
          </h3>
          <p className="text-start fw-normal">Anytime, Anywhere.</p>
        </div>

        {/* Connection Status */}
        {/* <div className="mb-2">
          <span
            className={`badge ${connected ? "bg-success" : "bg-secondary"}`}
          >
            {connected ? "🟢 Connected" : "🔴 Connecting..."}
          </span>
        </div> */}

        {/* Limit */}
        <div className="d-flex gap-2">
          <p className="text-muted">
            Max Limit: <strong>5GB</strong>
          </p>
          {connected ? (
            <i className="bi bi-cloud-sun-fill text-primary"></i>
          ) : (
            <i className="bi bi-cloud-lightning-rain-fill text-danger"></i>
          )}
        </div>

        {/* Input + Buttons */}
        <div className="d-flex gap-2 mb-3">
          <input
            value={channel}
            onChange={(e) => setChannel(sanitizeChannel(e.target.value))}
            maxLength={6}
            className="form-control text-center"
          />

          <button className="btn btn-outline-primary" onClick={handleRefresh}>
            <i className="bi bi-arrow-clockwise"></i>
          </button>
          <button className="btn btn-outline-primary" onClick={handleCopy}>
            <i className="bi bi-copy"></i>
          </button>
          <button className="btn btn-outline-primary" onClick={handleShare}>
            <i className="bi bi-share"></i>
          </button>
          <button className="btn btn-outline-primary" onClick={handleJoin}>
            <i className="bi bi-box-arrow-in-right"></i>
          </button>
        </div>
        <hr />

        {/* Hidden file input */}
        <input
          id="hidden-file-input"
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileSelected}
        />

        {/* Send Files */}
        <button
          className="btn btn-lg btn-primary w-100 mb-3"
          onClick={() =>
            openConfirm({
              title: "Share Files",
              message: "Your files will be shared across the channel.",
              onConfirm: () => {
                closeConfirm();
                setTimeout(() => {
                  fileInputRef.current?.click();
                }, 100);
              },
              onCancel: () => {
                closeConfirm();
              },
            })
          }
        >
          SEND FILES
        </button>
        <ConfirmModal
          show={isOpen}
          options={options}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />

        {/* File History */}
        <div className="border rounded p-3 bg-light mb-3">
          <div className="d-flex gap-2">
            <i className="bi bi-folder-symlink-fill"></i>
            <span className="fw-semibold">File History</span>
            <span className="fw-semibold">({fileHistory.length})</span>
          </div>

          <div>
            {fileHistory.length === 0 && (
              <p className="text-start text-muted small">
                Your sent and received files will appear here during this
                session
              </p>
            )}

            {fileHistory.map((f, i) => (
              <div key={i} className="small mb-1">
                <a
                  href={f.url}
                  download={f.name}
                  className="text-decoration-none"
                >
                  📁 {f.name} · {(f.size / 1024 / 1024).toFixed(2)} MB
                </a>
                {fileProgress[f.name] != null &&
                  fileProgress[f.name] <= 90 && (
                    <div className="progress mt-1">
                      <div
                        className="progress-bar"
                        style={{ width: `${fileProgress[f.name]}%` }}
                      />
                    </div>
                  )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-start small text-muted">
          <div>
            Contact support:{" "}
            <a
              href="mailto:holehuy.it@gmail.com"
              className="text-decoration-none"
            >
              holehuy.it@gmail.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
