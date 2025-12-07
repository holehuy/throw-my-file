export function generateChannel(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function sanitizeChannel(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
