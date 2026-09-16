"""カード画像をローカルに保存する。個人利用のツール向けにファイルとして持っておくためのもので、
再配布は想定していない(公式サイトの版権画像のため)。
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://www.takaratomy.co.jp/products/conan-cardgame/cardlist",
}
REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 0.3


def _extension(url: str) -> str:
    suffix = Path(url).suffix
    return suffix if suffix else ".jpg"


def download_images(cards: list[dict], out_dir: Path, delay: float = REQUEST_DELAY_SEC) -> None:
    """cards の image_url / sub_image_url をダウンロードし、各dictのそのフィールドを
    ローカルファイルへの相対パス(out_dir を基準にしたファイル名のみ)に書き換える。
    既にファイルが存在する場合はダウンロードをスキップする(再実行しても差分のみ取得)。
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    for card in cards:
        for field in ("image_url", "sub_image_url"):
            url = card.get(field)
            if not url:
                continue
            filename = f"{card['id']}{'_sub' if field == 'sub_image_url' else ''}{_extension(url)}"
            dest = out_dir / filename
            if not dest.exists():
                try:
                    resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
                    resp.raise_for_status()
                    dest.write_bytes(resp.content)
                    time.sleep(delay)
                except requests.RequestException as exc:
                    logger.warning("画像取得に失敗: %s (%s)", url, exc)
                    card[field] = None
                    continue
            card[field] = filename
