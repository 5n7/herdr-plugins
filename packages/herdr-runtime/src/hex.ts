/** Byte-wise hex of a UTF-8 string, matching `od -An -tx1 | tr -d ' \\n'`. */
export function hexKey(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
