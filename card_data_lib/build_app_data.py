"""conan-card-game (Electron AI対戦ビューア) 向けにカードデータを書き出すCLI。

使い方:
    python -m card_data_lib.build_app_data --packs CT-D01,CT-D02,CT-D03,CT-D04,CT-D05

デフォルトではスターターデッキ5種(CT-D01〜CT-D05、計80枚)を対象にする。
出力先: conan-card-game/data/cards-data.js (window.CARD_DATA = [...] 形式)
        conan-card-game/data/images/*.jpg  (カード画像)

Electronのレンダラープロセスは file:// で読み込まれ、fetch()でのローカルJSON読み込みが
環境によって制限されるため、<script>タグでそのまま読み込めるJS形式で書き出す。
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from card_data_lib import export_cards, download_images

DEFAULT_PACKS = ["CT-D01", "CT-D02", "CT-D03", "CT-D04", "CT-D05"]
APP_DATA_DIR = Path(__file__).resolve().parent.parent / "conan-card-game" / "data"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packs", default=",".join(DEFAULT_PACKS),
                         help="カンマ区切りのpack前方一致キーワード(例: CT-D01,CT-P01)。'ALL'を指定すると全カード対象")
    parser.add_argument("--out-dir", default=str(APP_DATA_DIR), help="出力先ディレクトリ")
    parser.add_argument("--limit", type=int, default=None, help="件数上限(動作確認用)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    pack_prefixes = None if args.packs.strip().upper() == "ALL" else [p.strip() for p in args.packs.split(",") if p.strip()]

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    images_dir = out_dir / "images"

    cards = export_cards(pack_prefixes=pack_prefixes, limit=args.limit)
    logging.info("対象カード %d件を書き出します (packs=%s)", len(cards), pack_prefixes or "ALL")

    download_images(cards, images_dir)

    js_path = out_dir / "cards-data.js"
    js_path.write_text(
        "// このファイルは card_data_lib/build_app_data.py により自動生成されます。直接編集しないでください。\n"
        "window.CARD_DATA = " + json.dumps(cards, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    logging.info("書き出し完了: %s (%d件)", js_path, len(cards))


if __name__ == "__main__":
    main()
