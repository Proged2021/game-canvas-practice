export default function Home() {
  return (
    <main>
      {/* アプリの説明 */}
      <h1>Game-Canvas</h1>
      <p>場面ごとにアイデアやメモを整理できます。</p>
      <p>アトラシアン Confluence™からのシナリオ取り込みに対応予定です。</p>
      {/* ログインカード */}
      <section className="auth-card">
        {/* メールアドレスでログイン */}
        <div className="email-login">
          <label htmlFor="email">メールアドレス</label>
          <input id="email" type="email" autoComplete="email"/>
          <button type="button" className="login-button">ログイン</button>
        </div>
        {/* 各サービスのアカウントでログイン */}
        <div className="social-buttons">
          <button type="button">Googleで続行</button>
          <button type="button">ChatGPTで続行</button>
          <button type="button">Appleで続行</button>
        </div>
        {/* メールアドレス登録 */}
        <div className="signup-guide"><p>アカウントをお持ちではありませんか？</p>
          <button type="button">登録</button></div>
      </section>
    </main>
  );
}
