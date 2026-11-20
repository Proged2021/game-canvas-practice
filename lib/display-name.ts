const FORBIDDEN_INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u;
const HTML_LIKE = /[<>]/u;

function validEmojiJoiners(value: string) {
  const chars = Array.from(value);
  const emoji = /\p{Extended_Pictographic}/u;
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] !== "\u200d") continue;
    let previous = index - 1;
    while (previous >= 0 && /[\ufe0e\ufe0f]/u.test(chars[previous])) previous -= 1;
    let next = index + 1;
    while (next < chars.length && /[\ufe0e\ufe0f]/u.test(chars[next])) next += 1;
    if (previous < 0 || next >= chars.length || !emoji.test(chars[previous]) || !emoji.test(chars[next])) return false;
  }
  return true;
}

export function validateWorkspaceDisplayName(value: unknown) {
  if (typeof value !== "string") return { error: "表示名を入力してください" } as const;
  const normalized = value.normalize("NFC").trim();
  const length = [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(normalized)].length;
  if (!length) return { error: "表示名を入力してください" } as const;
  if (length > 30) return { error: "表示名は30文字以内で入力してください" } as const;
  if (FORBIDDEN_INVISIBLE.test(normalized) || HTML_LIKE.test(normalized) || !validEmojiJoiners(normalized))
    return { error: "表示名に使用できない文字が含まれています" } as const;
  return { value: normalized } as const;
}
