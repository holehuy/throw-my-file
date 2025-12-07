import { useState } from "react";

export default function ConnectForm({
  onJoin,
}: {
  onJoin: (c: string) => void;
}) {
  const [channel, setChannel] = useState("");

  return (
    <div className="flex gap-3 p-4 items-center">
      <input
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
        placeholder="Channel ID"
        className="border p-2 rounded w-60"
      />
      <button
        onClick={() => onJoin(channel)}
        className="bg-blue-500 text-white px-4 py-2 rounded"
      >
        Join
      </button>
    </div>
  );
}
