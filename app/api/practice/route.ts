import { eq } from "drizzle-orm";
import { getDb } from "@/app/db";
import { practiceNames } from "@/app/db/schema";

// ローカル練習用。認証・権限確認は未実装。

// 表示名を新しく保存する
export async function POST(request: Request) {
  let body: unknown;

  // 送信データを読み取る
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

  // 前後の空白を除き、空の表示名を拒否する
  const displayName = body.displayName.trim();

  if (displayName === "") {
    return Response.json(
      { message: "表示名を入力してください。" },
      { status: 400 }
    );
  }

  // 表示名をDBに保存する
  try {
    const db = getDb();
    await db.insert(practiceNames).values({ displayName });
  } catch (error) {
    console.error("表示名の保存に失敗しました。", error);

    return Response.json(
      { message: "保存に失敗しました。開発サーバーのログを確認してください。" },
      { status: 500 }
    );
  }

  // 保存結果を返す
  return Response.json(
    {
      message: `${displayName}さんの表示名を保存しました。アカウント登録はまだ行っていません。`,
    },
    { status: 201 }
  );
}

// 保存済みの表示名を読み出す
export async function GET() {
  try {
    const db = getDb();

    // ID順に最大100件取得する
    const names = await db
      .select()
      .from(practiceNames)
      .orderBy(practiceNames.id)
      .limit(100);

    // 一覧を返し、応答をキャッシュさせない
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

// 指定したIDの表示名を変更する
export async function PATCH(request: Request) {
  let body: unknown;

  // 送信データを読み取る
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { message: "送信データの形式が正しくありません。" },
      { status: 400 }
    );
  }

  // IDと表示名の型を確認する
  if (
    typeof body !== "object" ||
    body === null ||
    !("id" in body) ||
    typeof body.id !== "number" ||
    !("displayName" in body) ||
    typeof body.displayName !== "string"
  ) {
    return Response.json(
      { message: "IDを数値、表示名を文字列で送ってください。" },
      { status: 400 }
    );
  }

  const id = body.id;
  const displayName = body.displayName.trim();

  // 不正なIDを拒否する
  if (!Number.isSafeInteger(id) || id < 1) {
    return Response.json(
      { message: "IDは1以上の整数で指定してください。" },
      { status: 400 }
    );
  }

  // 空の表示名を拒否する
  if (displayName === "") {
    return Response.json(
      { message: "表示名を入力してください。" },
      { status: 400 }
    );
  }

  try {
    const db = getDb();

    // IDが一致する行だけ変更する
    const updatedNames = await db
      .update(practiceNames)
      .set({ displayName })
      .where(eq(practiceNames.id, id))
      .returning();

    // 対象がなければエラーを返す
    if (updatedNames.length === 0) {
      return Response.json(
        { message: "指定したIDのデータが見つかりません。" },
        { status: 404 }
      );
    }

    // 変更結果を返す
    return Response.json({
      message: `ID：${id} の表示名を「${displayName}」に変更しました。`,
      name: updatedNames[0],
    });
  } catch (error) {
    console.error("表示名の変更に失敗しました。", error);

    return Response.json(
      { message: "表示名を変更できませんでした。" },
      { status: 500 }
    );
  }
}