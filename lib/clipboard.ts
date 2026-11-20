export type CopyMethod = "clipboard" | "fallback" | "failed";

type CopyEnvironment = {
  navigator?: Navigator | null;
  document?: Document | null;
};

function browserEnvironment(): CopyEnvironment {
  return {
    navigator: typeof navigator === "undefined" ? null : navigator,
    document: typeof document === "undefined" ? null : document,
  };
}

function fallbackCopy(text: string, documentObject: Document | null | undefined) {
  if (!documentObject?.body) return false;
  const textarea = documentObject.createElement("textarea");
  const activeElement = documentObject.activeElement
    && typeof (documentObject.activeElement as HTMLElement).focus === "function"
    ? documentObject.activeElement as HTMLElement
    : null;
  const selection = documentObject.getSelection?.() ?? null;
  const previousRanges: Range[] = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1)
      previousRanges.push(selection.getRangeAt(index).cloneRange());
  }
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    position: "fixed",
    inset: "-9999px auto auto -9999px",
    opacity: "0",
    pointerEvents: "none",
  });
  documentObject.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return typeof documentObject.execCommand === "function"
      && documentObject.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    try {
      textarea.remove();
    } catch {
      textarea.parentNode?.removeChild(textarea);
    }
    try {
      selection?.removeAllRanges();
      for (const range of previousRanges) selection?.addRange(range);
    } catch {
      // A detached iframe selection may no longer be restorable.
    }
    try {
      activeElement?.focus({ preventScroll: true });
    } catch {
      // The prior element may have been removed while the copy operation was running.
    }
  }
}

export async function copyTextWithFallback(
  text: string,
  environment: CopyEnvironment = browserEnvironment(),
): Promise<CopyMethod> {
  try {
    if (environment.navigator?.clipboard?.writeText) {
      await environment.navigator.clipboard.writeText(text);
      return "clipboard";
    }
  } catch {
    // Permission, iframe and secure-context failures intentionally continue to the DOM fallback.
  }
  return fallbackCopy(text, environment.document) ? "fallback" : "failed";
}
