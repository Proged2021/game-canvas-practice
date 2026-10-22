const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function lllmAccessPage(message: string) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LLLMを利用できません · Game Canvas</title></head><body><main>
<p>Game Canvas</p><h1>LLLMを利用できません</h1>
<p role="alert">${escapeHtml(message)}</p>
<p>LLLMの利用には、水無墓村と、起動先のワークスペースの両方への参加が必要です。共有されたリンクを開くだけでは、参加権限は付きません。</p>
<p>停止の解除や参加が必要な場合は、ワークスペースのオーナーへご確認ください。</p>
<p><a href="/">Game Canvasへ戻る</a></p>
</main></body></html>`;
}
