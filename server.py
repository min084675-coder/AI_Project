"""
server.py
luna.py の LunaChat を HTTP API として公開するサーバー。
ブラウザ上のゲーム（index.html / game.js）から fetch で呼び出せるようにする。

起動方法:
    pip install flask requests
    python server.py

デフォルトで http://localhost:5000 で待ち受ける。
"""

from flask import Flask, request, jsonify
from luna import LunaChat

app = Flask(__name__)

# ゲームと同時にLM Studioを使う想定。必要に応じて引数を調整してください。
luna = LunaChat()


# ---------- CORS対応 ----------
# index.htmlをfile://で直接開いたり、別ポートの簡易サーバーで配信したりする場合、
# ブラウザ側のOrigin制限に引っかかるため、全リクエストにCORSヘッダーを付与する。
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/chat", methods=["POST", "OPTIONS"])
def chat():
    # ブラウザが送るプリフライトリクエスト(OPTIONS)には空で200を返す
    if request.method == "OPTIONS":
        return "", 200

    body = request.get_json(silent=True) or {}
    user_message = body.get("message", "").strip()

    if not user_message:
        return jsonify({"error": "message が空です"}), 400

    try:
        result = luna.send_with_intent(user_message)
        return jsonify(result)  # {"reply": ..., "fetch_apple": true/false}
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502


@app.route("/reset", methods=["POST", "OPTIONS"])
def reset():
    if request.method == "OPTIONS":
        return "", 200
    luna.reset()
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    print("Luna APIサーバーを起動します: http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)