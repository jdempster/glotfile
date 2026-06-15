export interface Position { line: number; column: number }

export function locate(rawText: string, key: string): Position {
  const idx = rawText.indexOf(`"${key}"`);
  if (idx === -1) return { line: 1, column: 1 };
  let line = 1, column = 1;
  for (let i = 0; i < idx; i++) {
    if (rawText[i] === "\n") { line++; column = 1; } else { column++; }
  }
  return { line, column };
}
