import os
import json
import logging
from pathlib import Path
from datetime import datetime

import instaloader
from instaloader import Profile
import requests

# ============= SETTINGS OR WHATEVER =============

REPO_DIR = Path(__file__).resolve().parent

IMAGES_DIR = REPO_DIR / "assets" / "images" / "gallery" / "images"
DESCS_DIR = REPO_DIR / "assets" / "images" / "gallery" / "descriptions"
MAIN_JS = REPO_DIR / "main.js"

STATE_FILE = REPO_DIR / ".instagram_state.json"
LOG_FILE = REPO_DIR / ".instagram_sync.log"

INSTAGRAM_USERNAME = os.environ.get("INSTA_USERNAME")
INSTAGRAM_PASSWORD = os.environ.get("INSTA_PASSWORD")
TARGET_PROFILE = INSTAGRAM_USERNAME

MAX_POSTS_TO_SCAN = 30

GALLERY_MAX_ITEMS = 9

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler()
    ]
)

# ============= ANY ELPERS IN CHAT? =============

def ensure_dirs():
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    DESCS_DIR.mkdir(parents=True, exist_ok=True)


def load_state():
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            return set(data.get("shortcodes", []))
        except Exception as e:
            logging.warning("Failed to load state file: %s", e)
    return set()


def save_state(shortcodes):
    STATE_FILE.write_text(
        json.dumps({"shortcodes": sorted(shortcodes)}, indent=2),
        encoding="utf-8"
    )


def download_image(url: str, dest: Path):
    resp = requests.get(url, stream=True, timeout=30)
    resp.raise_for_status()
    with dest.open("wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)


def build_gallery_items_from_local_files():
    """
    Builds items for main.js that work from /pages/gallery.html.
    Those pages reference assets with ../assets/...
    """
    items = []

    for img_path in IMAGES_DIR.glob("*.jpg"):
        shortcode = img_path.stem
        desc_path = DESCS_DIR / f"{shortcode}.txt"
        if not desc_path.exists():
            continue

        mtime = datetime.fromtimestamp(img_path.stat().st_mtime)

        items.append({
            "shortcode": shortcode,
            "src": f"../assets/images/gallery/images/{img_path.name}",
            "url": f"https://www.instagram.com/p/{shortcode}/",
            "captionPath": f"../assets/images/gallery/descriptions/{shortcode}.txt",
            "mtime": mtime,
        })

    items.sort(key=lambda x: x["mtime"], reverse=True)
    return items[:GALLERY_MAX_ITEMS]


def update_main_js_items_block():
    """
    Rewrites ONLY the `const items = [...]` block inside main.js.
    Leaves everything else unchanged.
    """
    if not MAIN_JS.exists():
        logging.error("main.js not found at %s", MAIN_JS)
        return

    js = MAIN_JS.read_text(encoding="utf-8")

    marker_start = "const items = ["
    idx_start = js.find(marker_start)
    if idx_start == -1:
        logging.error("Could not find `const items = [` in main.js")
        return

    idx_array_start = idx_start + len(marker_start)
    idx_end = js.find("];", idx_array_start)
    if idx_end == -1:
        logging.error("Could not find closing `];` for items array in main.js")
        return

    gallery_items = build_gallery_items_from_local_files()
    logging.info("Updating main.js items array with %d entries", len(gallery_items))

    lines = []
    for it in gallery_items:
        lines.append(
            "      { "
            f"src: '{it['src']}', "
            f"url: '{it['url']}', "
            f"captionPath: '{it['captionPath']}' "
            "}"
        )

    new_block = ("\n" + "\n".join(lines) + "\n    ") if lines else "\n    "
    updated_js = js[:idx_array_start] + new_block + js[idx_end:]

    MAIN_JS.write_text(updated_js, encoding="utf-8")
    logging.info("main.js updated: %s", MAIN_JS)


# ============= WHERE THE MAGIC HAPPENS =============

def main():
    ensure_dirs()

    if not INSTAGRAM_USERNAME or not INSTAGRAM_PASSWORD:
        logging.error("Missing INSTA_USERNAME / INSTA_PASSWORD environment variables. Idiot.")
        return

    logging.info("Starting Instagram sync for: %s", TARGET_PROFILE)

    L = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False
    )

    try:
        L.login(INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD)
    except Exception as e:
        logging.error("Instagram login failed: %s", e)
        return

    profile = Profile.from_username(L.context, TARGET_PROFILE)

    known = load_state()
    new_shortcodes = []

    count = 0
    for post in profile.get_posts():
        if MAX_POSTS_TO_SCAN is not None and count >= MAX_POSTS_TO_SCAN:
            break
        count += 1

        shortcode = post.shortcode
        if shortcode in known:
            continue

        logging.info("New post found: %s", shortcode)
        new_shortcodes.append(shortcode)

        img_path = IMAGES_DIR / f"{shortcode}.jpg"
        txt_path = DESCS_DIR / f"{shortcode}.txt"

        try:
            download_image(post.url, img_path)
            caption = post.caption or ""
            txt_path.write_text(caption, encoding="utf-8")
            known.add(shortcode)
        except Exception as e:
            logging.error("Failed downloading %s: %s", shortcode, e)

    save_state(known)

    update_main_js_items_block()

    logging.info("Done. New posts this run: %d", len(new_shortcodes))


if __name__ == "__main__":
    main()
