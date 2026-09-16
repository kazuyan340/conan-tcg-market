"""名探偵コナンTCGのカードデータを、価格集計サイト側のスクレイピング結果(SQLite DB)から
他プロジェクト向けに書き出すための共通モジュール。

想定用途:
- conan-card-game (Electron製AI対戦ビューア) が、デッキ構築・盤面表示用のカードデータ
  (JSON + ローカル画像ファイル) を必要とするときに、このモジュールの export_cards() /
  download_images() を呼び出して生成する。

カードの取得自体(公式サイトAPIを叩く部分)は scraper_cards.py が既に担っており、
このモジュールはその結果が入った data/conan_tcg.db を読み出すだけで、
スクレイピングのロジックを重複させない。
"""
from .export import export_cards, CardExportError
from .images import download_images

__all__ = ["export_cards", "download_images", "CardExportError"]
