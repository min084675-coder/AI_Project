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

    # ---------- 発言後に「どの物体を目指すべきか」をモデル自身に判定させる ----------
    # 対象カテゴリはゲーム側の物体タイプと対応させる
    TARGET_CATEGORIES = {
        "apple": "リンゴ",
        "water": "水",
        "treasure": "宝箱",
        "enemy": "敵",
    }

    AUTONOMY_CATEGORIES = {**TARGET_CATEGORIES, "spell": "魔法"}

    def decide_autonomous_action(self, context: dict) -> dict:
        """現在のゲーム状況から、Lunaが次に取る行動を一度だけ決める。"""
        category_list = ", ".join(
            f'"{key}"({label})' for key, label in self.AUTONOMY_CATEGORIES.items()
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "あなたはゲームキャラクターLunaの自律行動を決める分類器です。"
                    "残っている物体、HP、MP、持ち物を見て、次に行う行動を1つ選んでください。"
                    f"選択肢は {category_list} です。探索対象がなければ null にしてください。"
                    "魔法はMPが15以上のときだけ選べます。JSONのみで返してください。"
                    '形式: {"action": "apple", "reply": "短い日本語の発言"}',
                ),
            },
            {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
        ]
        try:
            response = requests.post(
                self.api_url,
                json={"model": self.model, "messages": messages, "temperature": 0.3, "stream": False},
            )
            if not response.ok:
                return {"action": None, "reply": ""}
            content = response.json()["choices"][0]["message"]["content"].strip()
            if content.startswith("```"):
                content = content.strip("`").replace("json", "", 1).strip()
            parsed = json.loads(content)
            action = parsed.get("action")
            if action not in self.AUTONOMY_CATEGORIES:
                action = None
            return {"action": action, "reply": str(parsed.get("reply", ""))[:120]}
        except Exception:
            return {"action": None, "reply": ""}

    def generate_proactive_line(self, context: dict) -> str:
        """ゲーム状況をもとに、Lunaが自分から話す短い一言を生成する。"""
        messages = [
            {
                "role": "system",
                "content": (
                    "あなたはLunaです。ゲーム中に自分から話しかける短い一言を日本語で作ってください。"
                    "入力のterrainにはフィールドに残っている物体数が入っています。"
                    "リンゴ、水、宝箱、敵の残数やnearbyの見えている物体に必ず少し触れてください。"
                    "affinityはあなたとユーザーの好感度、memoriesは最近の出来事です。"
                    "好感度や記憶を不自然にならない範囲で会話に反映してください。"
                    "控えめで自然な一文、60文字以内にしてください。説明やJSONは不要です。"
                ),
            },
            {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
        ]
        response = requests.post(
            self.api_url,
            json={"model": self.model, "messages": messages, "temperature": self.temperature, "stream": False},
        )
        if not response.ok:
            raise RuntimeError(f"LM Studioとの通信に失敗しました: {response.status_code}")
        return response.json()["choices"][0]["message"]["content"].strip()[:60]

    def send_with_intent(self, user_message: str) -> dict:
        """通常の会話応答を生成したうえで、続けて
        『ユーザーの発言はLunaに何を探しに/取りに行くよう頼んだものか』を
        モデル自身に分類させる。会話履歴（self.messages）には影響しない。

        戻り値: {"reply": str, "target": "apple" | "water" | "treasure" | "enemy" | None}
        """
        reply = self.send(user_message)
        target = self._classify_target(user_message, reply)
        return {"reply": reply, "target": target}

    def _classify_target(self, user_message: str, luna_reply: str):
        """一回限りの分類リクエスト。会話の主履歴とは別に送る。"""
        category_list = ", ".join(
            f'"{key}"({label})' for key, label in self.TARGET_CATEGORIES.items()
        )

        classification_messages = [
            {
                "role": "system",
                "content": (
                    "あなたは分類器です。会話の文脈から、直前のユーザーの発言が"
                    "Lunaに何かを探しに行く／取りに行くよう頼んでいるかを判定してください。"
                    f"対象になりうるカテゴリは次のいずれかです: {category_list}。"
                    "該当するものがなければ null にしてください。"
                    "出力はJSONのみで、他の文章は一切含めないでください。"
                    '出力形式: {"target": "apple"} や {"target": "water"} や {"target": null} など。'
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
                return None

            data = response.json()
            content = data["choices"][0]["message"]["content"].strip()

            if content.startswith("```"):
                content = content.strip("`")
                content = content.replace("json", "", 1).strip()

            parsed = json.loads(content)
            target = parsed.get("target")
            if target in self.TARGET_CATEGORIES:
                return target
            return None
        except Exception:
            return None


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