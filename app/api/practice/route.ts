import { getDb } from "@/app/db";
import { practiceNames } from "@/app/db/schema";

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

  // 表示名を練習用テーブルへ保存する
  try {
    const db = getDb();
    // insert(practiceNames)：練習用テーブルに新しい行を追加する
    // values({ displayName })：保存する表示名を指定する
    // await：保存が終わるまで待つ
    await db.insert(practiceNames).values({ displayName });
  } catch (error) {
    console.error("表示名の保存に失敗しました。", error);

    return Response.json(
      { message: "保存に失敗しました。開発サーバーのログを確認してください。" },
      { status: 500 }
    );
  }

  return Response.json(
    {
      message: `${displayName}さんの表示名を保存しました。アカウント登録はまだ行っていません。`,
    },
    { status: 201 }
  );
}

// 保存済みの表示名を読み出す（ローカル練習用）
// ID順に最大100件読み出す」処理
export async function GET() {
  try {
    const db = getDb();
    const names = await db
      .select()
      .from(practiceNames)
      .orderBy(practiceNames.id)
      .limit(100);

    return Response.json(
      { names },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("表示名の読み出しに失敗しました。", error);

    return Response.json(
      { message: "表示名を読み出せませんでした。" },
      { status: 500 }
    );
  }
}