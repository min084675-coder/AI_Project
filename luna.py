"""
luna.py
Lunaとの会話ロジックをまとめたモジュール。

- CLIとして直接実行することもできる（python luna.py）
- 他のスクリプト（Flaskサーバー、ゲームなど）から import して
  LunaChat クラスだけを使い回すこともできる（移植しやすい構成）
"""

import requests
import os
import json


class LunaChat:
    """LM Studio (OpenAI互換API) と会話するためのクラス"""

    DEFAULT_SYSTEM_PROMPT = "あなたの名前はLunaです。ユーザーと自然に会話してください。"

    # 文字コード自動判定で試す候補（優先順）
    ENCODINGS = ["utf-8", "utf-8-sig", "cp932", "shift_jis"]

    def __init__(
        self,
        model: str = "qwen/qwen3.5-9b",
        api_url: str = "http://localhost:1234/v1/chat/completions",
        prompt_file: str = "ImmutableCore.txt",
        temperature: float = 0.7,
    ):
        self.model = model
        self.api_url = api_url
        self.temperature = temperature

        system_prompt = self._load_system_prompt(prompt_file)
        self.messages = [{"role": "system", "content": system_prompt}]

    # ---------- システムプロンプトの読み込み ----------
    def _load_system_prompt(self, path: str) -> str:
        """指定したテキストファイルの中身をシステムプロンプトとして読み込む。
        文字コードが不明でも自動で候補を試す。
        """
        if not os.path.exists(path):
            print(f"警告: {path} が見つかりません。デフォルトのプロンプトを使用します。")
            return self.DEFAULT_SYSTEM_PROMPT

        for enc in self.ENCODINGS:
            try:
                with open(path, "r", encoding=enc) as f:
                    return f.read()
            except UnicodeDecodeError:
                continue

        print(f"警告: {path} の文字コードを判別できませんでした。読み込める部分のみ使用します。")
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    # ---------- 会話 ----------
    def send(self, user_message: str) -> str:
        """ユーザーのメッセージを送り、Lunaの返答を文字列で返す。
        通信に失敗した場合は例外 RuntimeError を送出する。
        """
        self.messages.append({"role": "user", "content": user_message})

        response = requests.post(
            self.api_url,
            json={
                "model": self.model,
                "messages": self.messages,
                "temperature": self.temperature,
                "stream": False,
            },
        )

        if not response.ok:
            # 送ったユーザーメッセージは履歴から取り消しておく（次回リトライ可能にするため）
            self.messages.pop()
            raise RuntimeError(f"LM Studioとの通信に失敗しました: {response.status_code} {response.text}")

        data = response.json()
        reply = data["choices"][0]["message"]["content"]
        self.messages.append({"role": "assistant", "content": reply})
        return reply

    def reset(self):
        """会話履歴をシステムプロンプトだけの状態に戻す"""
        system_msg = self.messages[0]
        self.messages = [system_msg]

    def history(self):
        """現在の会話履歴（system含む）をそのまま返す"""
        return self.messages

    # ---------- 発言後に「指示だったかどうか」をモデル自身に判定させる ----------
    def send_with_intent(self, user_message: str) -> dict:
        """通常の会話応答を生成したうえで、続けて
        『ユーザーの発言はLunaにリンゴを取りに行くよう頼んだものか』を
        モデル自身に分類させる。会話履歴（self.messages）には影響しない。

        戻り値: {"reply": str, "fetch_apple": bool}
        """
        reply = self.send(user_message)
        fetch_apple = self._classify_fetch_intent(user_message, reply)
        return {"reply": reply, "fetch_apple": fetch_apple}

    def _classify_fetch_intent(self, user_message: str, luna_reply: str) -> bool:
        """一回限りの分類リクエスト。会話の主履歴とは別に送る。"""
        classification_messages = [
            {
                "role": "system",
                "content": (
                    "あなたは分類器です。会話の文脈から、直前のユーザーの発言が"
                    "「Lunaにリンゴを取りに行くよう頼んでいる／指示している」かどうかを判定してください。"
                    "出力はJSONのみで、他の文章は一切含めないでください。"
                    '出力形式: {"fetch_apple": true} または {"fetch_apple": false}'
                ),
            },
            {
                "role": "user",
                "content": f"ユーザーの発言: {user_message}\nLunaの返答: {luna_reply}",
            },
        ]

        try:
            response = requests.post(
                self.api_url,
                json={
                    "model": self.model,
                    "messages": classification_messages,
                    "temperature": 0,
                    "stream": False,
                },
            )
            if not response.ok:
                return False

            data = response.json()
            content = data["choices"][0]["message"]["content"].strip()

            # モデルが ```json ... ``` のようにコードフェンス付きで返すことがあるので取り除く
            if content.startswith("```"):
                content = content.strip("`")
                content = content.replace("json", "", 1).strip()

            parsed = json.loads(content)
            return bool(parsed.get("fetch_apple", False))
        except Exception:
            # 分類に失敗した場合は「指示ではなかった」扱いにして、安全側に倒す
            return False


# ---------- CLIとして直接実行した場合のみ動く ----------
def _run_cli():
    luna = LunaChat()

    print("Lunaとの会話を開始します。")
    print("終了するには exit と入力してください。")
    print("履歴をリセットするには reset と入力してください。\n")

    while True:
        user = input("You: ")

        if user.lower() == "exit":
            break

        if user.lower() == "reset":
            luna.reset()
            print("(会話履歴をリセットしました)")
            continue

        try:
            reply = luna.send(user)
            print("Luna:", reply)
        except RuntimeError as e:
            print(e)


if __name__ == "__main__":
    _run_cli()