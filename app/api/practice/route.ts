export async function POST(request: Request) {
  let body: unknown;

  // 送られてきたJSONを読み取る
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { message: "送信データの形式が正しくありません。" },
      { status: 400 }
    );
  }

  // 表示名が文字列か確認する
  if (
    typeof body !== "object" ||
    body === null ||
    !("displayName" in body) ||
    typeof body.displayName !== "string"
  ) {
    return Response.json(
      { message: "表示名を文字列で送ってください。" },
      { status: 400 }
    );
  }

  const displayName = body.displayName.trim();

  // 空白だけの名前を受け付けない
  if (displayName === "") {
    return Response.json(
      { message: "表示名を入力してください。" },
      { status: 400 }
    );
  }

  // 確認結果を返す（登録や保存はしない）
  return Response.json({
    message: `${displayName}さん、サーバーで入力を確認しました。登録はまだ行っていません。`,
  });
}