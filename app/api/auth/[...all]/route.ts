import { getAuth } from "@/app/lib/auth";

// 認証情報の取得リクエストを処理する
export async function GET(request: Request) {
  return getAuth().handler(request);
}

// 登録・ログイン・ログアウトのリクエストを処理する
export async function POST(request: Request) {
  return getAuth().handler(request);
}