"""Unified Luna persona, decision, and observation handling.

デバッグ: 環境変数 LUNA_DEBUG=1 で起動すると、LM Studioへ送った
メッセージ全文と受け取った生の応答をコンソールに表示する。
  PowerShell例:  $env:LUNA_DEBUG = "1"; python server.py
"""

import json
import os
import re
from pathlib import Path

import requests

DEBUG = os.environ.get("LUNA_DEBUG") == "1"


def _log(*args):
    print("[luna]", *args, flush=True)


class LunaChat:
    # utf-8-sig は BOM付き/なし両方のUTF-8を読める。UTF-8で読めなければ cp932(Shift_JIS)。
    ENCODINGS = ["utf-8-sig", "utf-8", "cp932", "shift_jis"]
    TARGET_CATEGORIES = {"apple": "apple", "water": "water", "treasure": "treasure", "enemy": "enemy"}
    ACTIONS = {**TARGET_CATEGORIES, "spell": "spell"}
    HISTORY_TURNS = 6          # 会話モードでモデルへ渡す直近の往復数
    MAX_STORED_MESSAGES = 40   # self.messages に保持する最大件数
    REQUEST_TIMEOUT = 120
    THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)

    def __init__(self, model="qwen/qwen3.5-9b", api_url="http://localhost:1234/v1/chat/completions", prompt_file="ImmutableCore.txt", rules_file="PromptRules.txt", temperature=0.7):
        self.model = model
        self.api_url = api_url
        self.temperature = temperature
        self.persona_prompt = self._load_text(prompt_file, "You are Luna.")
        self.rules_prompt = self._load_text(rules_file, "Use only confirmed game state and return JSON.")
        self.messages = [{"role": "system", "content": self._system_prompt("conversation")}]
        self.observations = []

    # ---------- プロンプト読み込み ----------
    def _load_text(self, path, fallback):
        prompt_path = Path(path)
        if not prompt_path.is_absolute():
            prompt_path = Path(__file__).resolve().parent / prompt_path
        if not prompt_path.exists():
            _log(f"WARNING: {prompt_path} が見つかりません。フォールバックを使用します。")
            return fallback
        raw = prompt_path.read_bytes()
        for encoding in self.ENCODINGS:
            try:
                text = raw.decode(encoding).strip()
            except UnicodeDecodeError:
                continue
            if not text:
                _log(f"WARNING: {prompt_path.name} が空です。フォールバックを使用します。")
                return fallback
            _log(f"loaded {prompt_path.name} ({encoding}, {len(text)} chars)")
            return text
        _log(f"WARNING: {prompt_path.name} の文字コードを判別できません。文字化けの可能性があります。")
        return raw.decode("utf-8", errors="replace").strip()

    def _system_prompt(self, mode):
        return self.persona_prompt + "\n\n" + self.rules_prompt + "\n\nMode: " + mode

    # ---------- LM Studio通信 ----------
    def _request(self, messages, temperature=None):
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature if temperature is None else temperature,
            "stream": False,
        }
        if DEBUG:
            _log("REQUEST:\n" + json.dumps(messages, ensure_ascii=False, indent=2))
        try:
            response = requests.post(self.api_url, json=payload, timeout=self.REQUEST_TIMEOUT)
        except requests.RequestException as error:
            raise RuntimeError("LM Studio に接続できません: " + str(error)) from error
        if not response.ok:
            raise RuntimeError(f"LM Studio request failed: {response.status_code} {response.text[:200]}")
        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise RuntimeError("LM Studio の応答形式が不正です") from error
        content = (content or "").strip()
        if DEBUG:
            _log("RESPONSE:\n" + content)
        return content

    # ---------- 応答の解析 ----------
    def _strip_thinking(self, content):
        content = self.THINK_RE.sub("", content)
        if "</think>" in content:  # 開始タグが欠けたまま閉じタグだけ来た場合
            content = content.split("</think>")[-1]
        return content.strip()

    def _parse_json(self, content):
        content = self._strip_thinking(content)
        start = content.find("{")
        end = content.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("JSONが見つかりません")
        parsed = json.loads(content[start:end + 1])
        if not isinstance(parsed, dict):
            raise ValueError("JSONオブジェクトではありません")
        action = parsed.get("action")
        return {
            "reply": str(parsed.get("reply", "")).strip()[:160],
            "action": action if action in self.ACTIONS else None,
            "reason": str(parsed.get("reason", ""))[:160],
        }

    def _with_observations(self, context):
        return {**context, "observations": self.observations[-8:]}

    # ---------- 判断 ----------
    def decide(self, context, user_message="", mode="autonomy", use_history=False):
        """通信エラー(RuntimeError)は握りつぶさず呼び出し側へ伝える。
        モデルの出力がJSONでない場合は、生テキストをreplyとして返す。"""
        state_text = "Game state:\n" + json.dumps(self._with_observations(context), ensure_ascii=False)
        content = state_text + ("\n\nUser message: " + user_message if user_message else "")

        messages = [{"role": "system", "content": self._system_prompt(mode)}]
        if use_history:
            messages.extend(self.messages[1:][-self.HISTORY_TURNS * 2:])
        messages.append({"role": "user", "content": content})

        temperature = self.temperature if use_history else 0.3
        raw = self._request(messages, temperature)
        try:
            return self._parse_json(raw)
        except (ValueError, TypeError):
            text = self._strip_thinking(raw)
            _log("WARNING: 応答がJSONではありませんでした。生テキストをreplyとして使用します:", raw[:200])
            return {"reply": text[:160], "action": None, "reason": "json_parse_failed"}

    def send_with_intent(self, user_message, game_context=None):
        result = self.decide(game_context or {}, user_message, "conversation_and_action", use_history=True)
        # 履歴にもJSON形式で残す（平文だとモデルが「JSONのみ」ルールを無視しやすくなるため）
        self.messages.append({"role": "user", "content": user_message})
        self.messages.append({
            "role": "assistant",
            "content": json.dumps(
                {"reply": result["reply"], "action": result["action"], "reason": result["reason"]},
                ensure_ascii=False,
            ),
        })
        self.messages = [self.messages[0]] + self.messages[1:][-self.MAX_STORED_MESSAGES:]
        return result

    def decide_autonomous_action(self, context):
        return self.decide(context, mode="observe_and_choose_one_game_action")

    def generate_proactive_line(self, context):
        return self.decide(context, mode="speak_about_current_observation")["reply"]

    def observe(self, event):
        self.observations.append(event)
        self.observations = self.observations[-20:]

    def reset(self):
        self.messages = [{"role": "system", "content": self._system_prompt("conversation")}]
        self.observations = []

    def history(self):
        return self.messages


def _run_cli():
    luna = LunaChat()
    while True:
        user = input("You: ")
        if user.lower() == "exit":
            break
        try:
            result = luna.send_with_intent(user)
            print("Luna:", result["reply"])
        except RuntimeError as error:
            print(error)


if __name__ == "__main__":
    _run_cli()
