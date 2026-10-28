"""公式サイトのカード画像のファイル名(カードID→ファイル名)の対応表を書き出す。

画像そのものは含めない(ファイル名だけ)。アプリは、ユーザーが公式サイトからダウンロードして
置いたフォルダの中から、この対応表のファイル名で画像を探す。

出力先: (このフォルダ)/data/image-names.js (window.CARD_IMAGE_NAMES = { "<id>": ["メイン画像", "裏面画像"] })
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from urllib.parse import urlparse

APP = Path(__file__).resolve().parent.parent
ROOT = APP.parent  # 元のデータベースがある親フォルダ
DB_PATH = ROOT / "data" / "conan_tcg.db"
OUT_PATH = APP / "data" / "image-names.js"


def _basename(url):
    if not url:
        return None
    name = Path(urlparse(url).path).name
    return name or None


def main():
    # アプリが実際に使うカード(cards-data.js)に絞る
    app_ids = None
    data_js = APP / "data" / "cards-data.js"
    if data_js.exists():
        text = data_js.read_text(encoding="utf-8")
        body = text[text.index("["):text.rindex("]") + 1]
        app_ids = {c["id"] for c in json.loads(body)}

    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, image_url, sub_image_url FROM cards").fetchall()
    names = {}
    for cid, main_url, sub_url in rows:
        if app_ids is not None and cid not in app_ids:
            continue
        main_name, sub_name = _basename(main_url), _basename(sub_url)
        if main_name:
            names[str(cid)] = [main_name, sub_name]

    OUT_PATH.write_text(
        "// このファイルは card_data_lib/build_image_names.py により自動生成されます。直接編集しないでください。\n"
        "// カードID → [メイン画像のファイル名, 裏面画像のファイル名]。公式サイトの画像のファイル名のみで、画像は含みません。\n"
        "window.CARD_IMAGE_NAMES = " + json.dumps(names, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"書き出し完了: {OUT_PATH} ({len(names)}件)")


if __name__ == "__main__":
    sys.exit(main())
