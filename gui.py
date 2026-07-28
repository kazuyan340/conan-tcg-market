"""名探偵コナンTCG カード図鑑 GUI (tkinter)。

- 起動時にDBが空なら初回全件取得を行う
- カード一覧を検索・フィルタしてページ単位(50件)で表示、サムネイルは表示中ページのみ非同期取得
- カードを選択すると詳細ウィンドウ、そこから価格推移ウィンドウ(機能②)へ遷移
"""
import io
import threading
import tkinter as tk
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tkinter import messagebox, ttk

import matplotlib
import requests
from PIL import Image, ImageTk

import db
import scraper_cards

# Windows標準搭載の日本語フォントを指定 (未指定だとグラフの日本語が文字化けする)
matplotlib.rcParams["font.family"] = ["Yu Gothic", "Meiryo", "MS Gothic", "sans-serif"]
matplotlib.rcParams["axes.unicode_minus"] = False

IMAGE_CACHE_DIR = Path(__file__).parent / "data" / "card_images"
IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

THUMB_SIZE = (120, 168)
DETAIL_IMAGE_SIZE = (240, 336)
PAGE_SIZE = 50
GRID_COLUMNS = 6
TILE_WIDTH = 150

FILTER_COLUMNS = {"色": "color", "種類": "card_type", "レアリティ": "rarity", "レベル": "level"}


def download_image(url: str, cache_path: Path) -> bytes | None:
    if cache_path.exists():
        return cache_path.read_bytes()
    try:
        resp = requests.get(url, headers=scraper_cards.HEADERS, timeout=10)
        resp.raise_for_status()
        cache_path.write_bytes(resp.content)
        return resp.content
    except requests.RequestException:
        return None


def make_placeholder_photo(size=THUMB_SIZE) -> ImageTk.PhotoImage:
    img = Image.new("RGB", size, color="#dddddd")
    return ImageTk.PhotoImage(img)


class CardListApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("名探偵コナンTCG カード図鑑")
        self.geometry("1100x720")

        self.conn = db.get_connection()
        db.init_db(self.conn)

        self.executor = ThreadPoolExecutor(max_workers=4)
        self.photo_cache: dict[int, ImageTk.PhotoImage] = {}
        self.tile_widgets: dict[int, ttk.Label] = {}

        self.current_results: list = []
        self.current_page = 0
        self.current_modal: "CardDetailModal | None" = None

        self._build_widgets()
        self.placeholder_photo = make_placeholder_photo()

        if db.count_cards(self.conn) == 0:
            self.after(200, self._prompt_initial_sync)
        else:
            self.refresh_filter_options()
            self.run_search()

    # ---------- UI構築 ----------
    def _build_widgets(self):
        top = ttk.Frame(self, padding=8)
        top.pack(side=tk.TOP, fill=tk.X)

        ttk.Label(top, text="キーワード:").pack(side=tk.LEFT)
        self.keyword_var = tk.StringVar()
        entry = ttk.Entry(top, textvariable=self.keyword_var, width=20)
        entry.pack(side=tk.LEFT, padx=(2, 10))
        entry.bind("<Return>", lambda e: self.run_search())

        self.filter_vars: dict[str, tk.StringVar] = {}
        for label, column in FILTER_COLUMNS.items():
            ttk.Label(top, text=f"{label}:").pack(side=tk.LEFT)
            var = tk.StringVar(value="すべて")
            combo = ttk.Combobox(top, textvariable=var, width=10, state="readonly")
            combo.pack(side=tk.LEFT, padx=(2, 10))
            self.filter_vars[column] = (var, combo)

        ttk.Button(top, text="検索", command=self.run_search).pack(side=tk.LEFT, padx=4)
        ttk.Button(top, text="データ更新(全件再取得)", command=self.run_sync).pack(side=tk.LEFT, padx=4)

        self.status_var = tk.StringVar(value="")
        ttk.Label(self, textvariable=self.status_var, padding=(8, 0)).pack(side=tk.TOP, anchor="w")

        grid_outer = ttk.Frame(self)
        grid_outer.pack(fill=tk.BOTH, expand=True, padx=8, pady=4)

        self.grid_canvas = tk.Canvas(grid_outer, highlightthickness=0)
        vsb = ttk.Scrollbar(grid_outer, orient="vertical", command=self.grid_canvas.yview)
        self.grid_canvas.configure(yscrollcommand=vsb.set)
        self.grid_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb.pack(side=tk.LEFT, fill=tk.Y)

        self.grid_inner = ttk.Frame(self.grid_canvas)
        self.grid_window = self.grid_canvas.create_window((0, 0), window=self.grid_inner, anchor="nw")

        self.grid_inner.bind(
            "<Configure>",
            lambda e: self.grid_canvas.configure(scrollregion=self.grid_canvas.bbox("all")),
        )
        self.grid_canvas.bind(
            "<Configure>",
            lambda e: self.grid_canvas.itemconfig(self.grid_window, width=e.width),
        )
        def _on_mousewheel(event):
            self.grid_canvas.yview_scroll(int(-event.delta / 120), "units")

        # キャンバス上にマウスがある間だけホイールを割り当てる(他ウィンドウのスクロールを妨げないため)
        self.grid_canvas.bind("<Enter>", lambda e: self.grid_canvas.bind_all("<MouseWheel>", _on_mousewheel))
        self.grid_canvas.bind("<Leave>", lambda e: self.grid_canvas.unbind_all("<MouseWheel>"))

        pager = ttk.Frame(self, padding=8)
        pager.pack(side=tk.BOTTOM, fill=tk.X)
        ttk.Button(pager, text="< 前へ", command=self.prev_page).pack(side=tk.LEFT)
        self.page_label_var = tk.StringVar(value="")
        ttk.Label(pager, textvariable=self.page_label_var).pack(side=tk.LEFT, padx=8)
        ttk.Button(pager, text="次へ >", command=self.next_page).pack(side=tk.LEFT)

    def refresh_filter_options(self):
        for column, (var, combo) in self.filter_vars.items():
            values = ["すべて"] + [str(v) for v in db.get_distinct_values(self.conn, column)]
            combo["values"] = values

    # ---------- 検索・ページング ----------
    def run_search(self):
        keyword = self.keyword_var.get().strip()
        filters = {}
        for column, (var, _combo) in self.filter_vars.items():
            value = var.get()
            if value and value != "すべて":
                filters[column] = [value]

        rows = db.search_cards(
            self.conn,
            keyword=keyword,
            colors=filters.get("color"),
            types=filters.get("card_type"),
            rarities=filters.get("rarity"),
            levels=filters.get("level"),
        )
        self.current_results = rows
        self.current_page = 0
        self.status_var.set(f"{len(rows)} 件ヒット")
        self.render_page()

    def render_page(self):
        for child in self.grid_inner.winfo_children():
            child.destroy()
        self.tile_widgets.clear()

        start = self.current_page * PAGE_SIZE
        page_rows = self.current_results[start:start + PAGE_SIZE]
        total_pages = max(1, (len(self.current_results) + PAGE_SIZE - 1) // PAGE_SIZE)
        self.page_label_var.set(f"ページ {self.current_page + 1} / {total_pages}")

        for col in range(GRID_COLUMNS):
            self.grid_inner.columnconfigure(col, weight=1)

        for index, row in enumerate(page_rows):
            self._create_tile(row, index // GRID_COLUMNS, index % GRID_COLUMNS)

        self.grid_canvas.yview_moveto(0)

        for row in page_rows:
            self.executor.submit(self._load_thumbnail, row["id"], row["image_url"])

    def _create_tile(self, row, grid_row: int, grid_col: int):
        card_id = row["id"]
        tile = ttk.Frame(self.grid_inner, padding=6, relief="groove", borderwidth=1)
        tile.grid(row=grid_row, column=grid_col, sticky="n", padx=4, pady=4)

        img_label = ttk.Label(tile, image=self.photo_cache.get(card_id, self.placeholder_photo))
        img_label.pack()
        name_label = ttk.Label(
            tile, text=row["name"], wraplength=TILE_WIDTH, justify=tk.CENTER, font=("", 9, "bold")
        )
        name_label.pack(fill=tk.X)
        sub_label = ttk.Label(
            tile, text=f"{row['rarity'] or ''} / {row['color'] or ''}", justify=tk.CENTER, foreground="gray"
        )
        sub_label.pack(fill=tk.X)

        for widget in (tile, img_label, name_label, sub_label):
            widget.bind("<Button-1>", lambda e, cid=card_id: self.open_detail(cid))
            widget.configure(cursor="hand2")

        self.tile_widgets[card_id] = img_label

    def _load_thumbnail(self, card_id: int, image_url: str | None):
        if not image_url:
            return
        cache_path = IMAGE_CACHE_DIR / f"{card_id}_thumb.jpg"
        data = download_image(image_url, cache_path)
        if not data:
            return
        try:
            img = Image.open(io.BytesIO(data)).convert("RGB")
            img.thumbnail(THUMB_SIZE)
            self.after(0, self._apply_thumbnail, card_id, img)
        except Exception:
            pass

    def _apply_thumbnail(self, card_id: int, img: Image.Image):
        photo = ImageTk.PhotoImage(img)
        self.photo_cache[card_id] = photo
        label = self.tile_widgets.get(card_id)
        if label is not None and label.winfo_exists():
            label.configure(image=photo)

    def prev_page(self):
        if self.current_page > 0:
            self.current_page -= 1
            self.render_page()

    def next_page(self):
        total_pages = max(1, (len(self.current_results) + PAGE_SIZE - 1) // PAGE_SIZE)
        if self.current_page < total_pages - 1:
            self.current_page += 1
            self.render_page()

    # ---------- 詳細表示(モーダル) ----------
    def open_detail(self, card_id: int):
        if self.current_modal is not None and self.current_modal.winfo_exists():
            self.current_modal.close()
        row = db.get_card(self.conn, card_id)
        if row is None:
            return
        self.current_modal = CardDetailModal(self, self.conn, row)

    # ---------- 全件データ更新 ----------
    def _prompt_initial_sync(self):
        if messagebox.askyesno(
            "初回データ取得",
            "カードデータがまだありません。公式サイトから全カード情報(約2240件)を取得しますか？\n"
            "(数十秒かかります)",
        ):
            self.run_sync()

    def run_sync(self):
        progress_win = tk.Toplevel(self)
        progress_win.title("データ取得中")
        progress_win.geometry("360x100")
        progress_win.transient(self)
        label_var = tk.StringVar(value="開始しています...")
        ttk.Label(progress_win, textvariable=label_var, padding=10).pack()
        bar = ttk.Progressbar(progress_win, mode="determinate", length=300)
        bar.pack(pady=4)

        def progress_callback(page, last_page, total):
            bar["maximum"] = last_page
            bar["value"] = page
            label_var.set(f"ページ {page}/{last_page} ({total} 件取得)")

        def worker():
            try:
                result = scraper_cards.sync_all_cards(
                    progress_callback=lambda p, lp, t: self.after(0, progress_callback, p, lp, t)
                )
                self.after(0, self._on_sync_done, progress_win, result)
            except Exception as exc:
                self.after(0, self._on_sync_error, progress_win, exc)

        threading.Thread(target=worker, daemon=True).start()

    def _on_sync_done(self, progress_win: tk.Toplevel, result: dict):
        progress_win.destroy()
        messagebox.showinfo(
            "データ取得完了",
            f"新規 {result['new']} 件 / 更新 {result['updated']} 件 / 合計 {result['total']} 件",
        )
        self.refresh_filter_options()
        self.run_search()

    def _on_sync_error(self, progress_win: tk.Toplevel, exc: Exception):
        progress_win.destroy()
        messagebox.showerror("データ取得エラー", f"取得中にエラーが発生しました:\n{exc}")

    def destroy(self):
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.conn.close()
        super().destroy()


class CardDetailModal(tk.Toplevel):
    """カードクリック時に画面遷移ではなくモーダルとして開く詳細ポップアップ。

    タイトルバーなしのウィンドウ + 背景を暗くするオーバーレイで
    「その場に浮かぶカード」のような見た目にしている。
    """

    MODAL_WIDTH = 680

    def __init__(self, app: CardListApp, conn, row):
        super().__init__(app)
        self.app = app
        self.conn = conn
        self.row = row

        self.overrideredirect(True)
        self.configure(bg="#999999")

        self.overlay = tk.Toplevel(app)
        self.overlay.overrideredirect(True)
        self.overlay.configure(bg="black")
        try:
            self.overlay.attributes("-alpha", 0.4)
        except tk.TclError:
            pass
        self.overlay.geometry(
            f"{app.winfo_width()}x{app.winfo_height()}+{app.winfo_x()}+{app.winfo_y()}"
        )
        self.overlay.bind("<Button-1>", lambda e: self.close())

        card = tk.Frame(self, bg="white")
        card.pack(padx=1, pady=1)

        header = tk.Frame(card, bg="white")
        header.pack(fill=tk.X)
        close_btn = tk.Label(header, text="✕", font=("", 13, "bold"), bg="white", fg="#666666", cursor="hand2")
        close_btn.pack(side=tk.RIGHT, padx=10, pady=6)
        close_btn.bind("<Button-1>", lambda e: self.close())

        max_height = min(860, self.winfo_screenheight() - 120)
        canvas = tk.Canvas(card, width=self.MODAL_WIDTH, height=max_height, bg="white", highlightthickness=0)
        vsb = ttk.Scrollbar(card, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=vsb.set)
        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb.pack(side=tk.LEFT, fill=tk.Y)

        inner = ttk.Frame(canvas, padding=16)
        inner_window = canvas.create_window((0, 0), window=inner, anchor="nw")
        inner.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfig(inner_window, width=e.width))

        def _on_mousewheel(event):
            canvas.yview_scroll(int(-event.delta / 120), "units")

        canvas.bind("<Enter>", lambda e: canvas.bind_all("<MouseWheel>", _on_mousewheel))
        canvas.bind("<Leave>", lambda e: canvas.unbind_all("<MouseWheel>"))

        self._build(inner, row)

        self.bind("<Escape>", lambda e: self.close())
        self.protocol("WM_DELETE_WINDOW", self.close)

        self.update_idletasks()
        content_height = inner.winfo_reqheight()
        canvas.configure(height=min(content_height, max_height))
        self.update_idletasks()
        self._center_over_app()
        self.transient(app)
        self.overlay.lift()
        self.lift()
        self.grab_set()

    def _center_over_app(self):
        w = self.winfo_reqwidth()
        h = self.winfo_reqheight()
        x = self.app.winfo_x() + max(0, (self.app.winfo_width() - w) // 2)
        y = self.app.winfo_y() + max(0, (self.app.winfo_height() - h) // 2)
        self.geometry(f"{w}x{h}+{x}+{y}")

    def close(self):
        try:
            self.grab_release()
        except tk.TclError:
            pass
        self.overlay.destroy()
        self.destroy()
        if self.app.current_modal is self:
            self.app.current_modal = None

    def _build(self, outer, row):
        top = ttk.Frame(outer)
        top.pack(fill=tk.X)

        image_frame = ttk.Frame(top)
        image_frame.pack(side=tk.LEFT, anchor="n", padx=(0, 10))
        self.image_label = ttk.Label(image_frame, text="読み込み中...")
        self.image_label.pack()
        if row["image_url"]:
            threading.Thread(target=self._load_detail_image, args=(row["id"], row["image_url"]), daemon=True).start()

        info_frame = ttk.Frame(top)
        info_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        def add_field(label, value):
            if value in (None, ""):
                return
            line = ttk.Frame(info_frame)
            line.pack(fill=tk.X, pady=1)
            ttk.Label(line, text=f"{label}:", width=10, anchor="w", font=("", 9, "bold")).pack(side=tk.LEFT)
            ttk.Label(line, text=str(value), wraplength=380, justify=tk.LEFT).pack(side=tk.LEFT, fill=tk.X)

        add_field("カードID", row["card_id"])
        add_field("カード番号", row["card_num"])
        add_field("種類", row["card_type"])
        add_field("色", row["color"])
        add_field("レアリティ", row["rarity"])
        add_field("特徴", row["category"])
        add_field("レベル", row["level"])
        add_field("AP", row["ap"])
        add_field("LP", row["lp"])
        add_field("事件レベル", self._difficulty_text(row))
        add_field("収録パック", row["pack"])
        add_field("イラストレーター", row["illustrator"])

        ttk.Label(info_frame, text="能力テキスト:", font=("", 9, "bold")).pack(anchor="w", pady=(8, 0))
        ability_text = tk.Text(info_frame, height=6, wrap=tk.WORD)
        ability_text.insert("1.0", row["ability_text"] or "(なし)")
        ability_text.configure(state="disabled")
        ability_text.pack(fill=tk.X)

        for label, value in (("ひらめき", row["hirameki"]), ("カットイン", row["cut_in"]), ("変装", row["henso"])):
            if value:
                ttk.Label(info_frame, text=f"{label}:", font=("", 9, "bold")).pack(anchor="w", pady=(6, 0))
                t = tk.Text(info_frame, height=3, wrap=tk.WORD)
                t.insert("1.0", value)
                t.configure(state="disabled")
                t.pack(fill=tk.X)

        if row["flavor_text"]:
            ttk.Label(info_frame, text="フレーバーテキスト:", font=("", 9, "bold")).pack(anchor="w", pady=(6, 0))
            ttk.Label(info_frame, text=row["flavor_text"], wraplength=380, justify=tk.LEFT).pack(anchor="w")

        ttk.Separator(outer, orient="horizontal").pack(fill=tk.X, pady=10)
        self._build_price_section(outer, row)

    def _difficulty_text(self, row):
        first, second = row["difficulty_first"], row["difficulty_second"]
        if first is None and second is None:
            return None
        parts = []
        if first is not None:
            parts.append(f"先攻{first}")
        if second is not None:
            parts.append(f"後攻{second}")
        return " ".join(parts)

    def _load_detail_image(self, card_id: int, image_url: str):
        cache_path = IMAGE_CACHE_DIR / f"{card_id}_full.jpg"
        data = download_image(image_url, cache_path)
        if not data:
            self.after(0, lambda: self.image_label.configure(text="画像を取得できませんでした"))
            return
        try:
            img = Image.open(io.BytesIO(data)).convert("RGB")
            img.thumbnail(DETAIL_IMAGE_SIZE)
            photo = ImageTk.PhotoImage(img)

            def apply():
                self.image_label.configure(image=photo, text="")
                self.image_label.image = photo  # 参照保持

            self.after(0, apply)
        except Exception:
            self.after(0, lambda: self.image_label.configure(text="画像の表示に失敗しました"))

    def _build_price_section(self, parent, row):
        """機能②: 価格推移グラフを詳細画面内に直接埋め込む。

        価格取得スクレイパー(駿河屋/メルカリ/ヤフオク)は未実装のため、
        price_history テーブルにデータがある場合のみグラフを描画する。
        """
        ttk.Label(parent, text="相場推移", font=("", 10, "bold")).pack(anchor="w")

        history = db.get_price_history(self.conn, row["id"])

        if not history:
            ttk.Label(
                parent,
                text="価格データがありません。価格取得機能(駿河屋・メルカリ・ヤフオク)は未実装です。",
                padding=10,
                foreground="gray",
            ).pack(anchor="w")
            return

        from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
        from matplotlib.figure import Figure

        prices = [h["price"] for h in history]
        stats = ttk.Frame(parent, padding=(0, 4))
        stats.pack(fill=tk.X)
        ttk.Label(
            stats,
            text=f"最安値: {min(prices)}円  最高値: {max(prices)}円  平均: {int(sum(prices) / len(prices))}円",
        ).pack(anchor="w")

        fig = Figure(figsize=(6.2, 3.6))
        ax = fig.add_subplot(111)

        by_site: dict[str, list] = {}
        for h in history:
            by_site.setdefault(h["site"], []).append(h)

        for site, items in by_site.items():
            ax.plot([i["recorded_at"] for i in items], [i["price"] for i in items], marker="o", label=site)

        ax.set_xlabel("日時")
        ax.set_ylabel("価格(円)")
        ax.legend()
        fig.autofmt_xdate()

        canvas = FigureCanvasTkAgg(fig, master=parent)
        canvas.draw()
        canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)


if __name__ == "__main__":
    app = CardListApp()
    app.mainloop()
