"""Unified Luna persona, decision, and observation handling."""

import json
import os
from pathlib import Path
from typing import Any

import requests


class LunaChat:
    ENCODINGS = ["utf-8", "utf-8-sig", "cp932", "shift_jis"]
    TARGET_CATEGORIES = {"apple": "apple", "water": "water", "treasure": "treasure", "enemy": "enemy"}
    ACTIONS = {**TARGET_CATEGORIES, "spell": "spell"}

    def __init__(self, model="qwen/qwen3.5-9b", api_url="http://localhost:1234/v1/chat/completions", prompt_file="ImmutableCore.txt", rules_file="PromptRules.txt", temperature=0.7):
        self.model = model
        self.api_url = api_url
        self.temperature = temperature
        self.persona_prompt = self._load_text(prompt_file, "You are Luna.")
        self.rules_prompt = self._load_text(rules_file, "Use only confirmed game state and return JSON.")
        self.messages = [{"role": "system", "content": self._system_prompt("conversation")}]
        self.observations = []

    def _load_text(self, path, fallback):
        prompt_path = Path(path)
        if not prompt_path.is_absolute():
            prompt_path = Path(__file__).resolve().parent / prompt_path
        if not prompt_path.exists():
            return fallback
        for encoding in self.ENCODINGS:
            try:
                with open(prompt_path, "r", encoding=encoding) as file:
                    return file.read()
            except UnicodeDecodeError:
                continue
        with open(prompt_path, "r", encoding="utf-8", errors="replace") as file:
            return file.read()

    def _system_prompt(self, mode):
        return self.persona_prompt + "\n\n" + self.rules_prompt + "\n\nMode: " + mode

    def _request(self, messages, temperature=None):
        response = requests.post(self.api_url, json={"model": self.model, "messages": messages, "temperature": self.temperature if temperature is None else temperature, "stream": False})
        if not response.ok:
            raise RuntimeError("LM Studio request failed: " + str(response.status_code))
        return response.json()["choices"][0]["message"]["content"].strip()

    def _parse_json(self, content):
        if content.startswith("```"):
            content = content.strip("`").replace("json", "", 1).strip()
        parsed = json.loads(content)
        action = parsed.get("action")
        return {"reply": str(parsed.get("reply", ""))[:160], "action": action if action in self.ACTIONS else None, "reason": str(parsed.get("reason", ""))[:160]}

    def _with_observations(self, context):
        return {**context, "observations": self.observations[-8:]}

    def decide(self, context, user_message="", mode="autonomy"):
        content = json.dumps(self._with_observations(context), ensure_ascii=False)
        if user_message:
            content = "User message: " + user_message + "\n\nGame state:\n" + content
        messages = [{"role": "system", "content": self._system_prompt(mode)}, {"role": "user", "content": content}]
        try:
            return self._parse_json(self._request(messages, 0.3))
        except (RuntimeError, ValueError, KeyError, TypeError):
            return {"reply": "", "action": None, "reason": "decision_failed"}

    def send_with_intent(self, user_message, game_context=None):
        result = self.decide(game_context or {}, user_message, "conversation_and_action")
        self.messages.append({"role": "user", "content": user_message})
        self.messages.append({"role": "assistant", "content": result["reply"]})
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
        result = luna.send_with_intent(user)
        print("Luna:", result["reply"])


if __name__ == "__main__":
    _run_cli()
