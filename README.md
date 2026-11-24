# ito - 数字配布ツール

部屋コードで集まり、ホストが開始すると、お題と1〜100の重複しない数字を配る静的Webアプリです。お題は全員に表示され、数字はSupabaseのサーバー側で管理し、参加者は自分の数字だけ取得できます。

## Supabaseの準備

1. Supabaseでプロジェクトを作成します。
2. Authenticationの設定で匿名サインインを有効にします。
3. SQL Editorで `supabase.sql`、`upgrade-rounds.sql`、`upgrade-security.sql` をこの順に、それぞれ内容を全選択して実行します。
4. Project SettingsからProject URLと公開用のPublishable keyを確認します。Secret keyや`service_role`キーは使用しないでください。
5. `config.js`の`supabaseUrl`と`supabaseAnonKey`にProject URLとPublishable keyを設定します。
6. 以下の手順でCloudflare TurnstileとSupabaseのCAPTCHAを設定します。

Publishable keyはブラウザーに配信されます。データ保護はキーを隠すのではなく、SQLで設定したRLSとRPC関数の認可で行います。

### 既存のアプリをアップデートする場合

すでに `supabase.sql` と `upgrade-rounds.sql` を実行済みの場合は、SupabaseのSQL Editorで `upgrade-security.sql` の内容を全選択して実行します。既存の部屋や参加者は削除されませんが、20人を超える部屋では配布できないため、新しく部屋を作り直してください。

### CAPTCHAの設定

1. [Cloudflare Turnstile](https://dash.cloudflare.com/) でウィジェットを作成します。GitHub Pagesのホスト名（例：`ユーザー名.github.io`）を許可対象に設定します。ローカルでも試す場合は `localhost` も許可します。
2. 表示されるSitekeyを `config.js` の `turnstileSiteKey` に設定します。これは公開用のキーです。Secret keyはファイルやGitHubに入れないでください。
3. 更新した `config.js`、`index.html`、`styles.css`、`app.js`、`upgrade-security.sql`、`README.md` をGitHubへアップロードし、GitHub Pagesに反映されるのを待ちます。
4. Supabaseの **Authentication → Attack Protection → CAPTCHA protection** でTurnstileを選び、CloudflareのSecret keyを入力して保存します。Secret keyはSupabaseの設定画面だけで扱ってください。
5. シークレットウィンドウなどの新規セッションで公開サイトを開き、CAPTCHA後に部屋を作成・参加できることを確認します。既存のログイン済みセッションではCAPTCHAは表示されません。

CAPTCHAは自動化を抑える対策であり、不正利用を完全に防ぐものではありません。Supabaseの利用量やレート制限も確認してください。設定前は新規ユーザーがアプリを利用できません。Supabase側でCAPTCHAを有効にした後は、古いアプリからの新規サインインもできなくなります。

## GitHub Pagesで公開

1. このフォルダーをGitHubリポジトリに登録します。
2. GitHubリポジトリの **Settings → Pages** で、公開元を `Deploy from a branch`、ブランチを `main`、フォルダーを `/ (root)` に設定します。
3. 公開されたPagesのURLを仲間に共有します。

SupabaseのURLと公開用キーを設定した`config.js`もリポジトリに登録してください。このキーは公開前提の値であり、Secret key、`service_role`キーやパスワードなどの秘密情報は絶対に設定しないでください。

## 遊び方

1. 名前を入力して部屋を作成し、表示された8桁の部屋コードを共有します。
2. ほかの参加者は名前と8桁のコードを入力して参加します。
3. ホストはお題のレベル1〜4を選び、ランダム・自由入力・お題なしから選択して開始します。
4. お題は全員に、数字はそれぞれ自分のものだけが表示されます。数字が大きいほどお題の程度が高くなるように表現します。
5. 続けて遊ぶときは、ホストが「次のお題と数字を配る」を押します。

待機中にホームへ戻ると参加登録が解除されます。ホストが戻ると待機中の部屋は削除されます。配布後は再接続できるよう参加登録を保持します。

## 開発時の注意

- ルームと参加者はSupabaseに保存されます。データベースのバックアップや利用上限はSupabaseの設定に従います。
- 部屋コードは8桁の16進数です。参加用コードは招待した人にだけ共有してください。
- 1部屋あたり最大20人です。人数制限は大量の参加者による消去法を難しくしますが、共謀や推測を完全には防げません。
- 数字の配布後、新しい参加者はその部屋に参加できません。配布後にホームへ戻っても参加登録が保持されるため、続けて遊ぶ際は部屋に残ります。
