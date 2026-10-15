import os
import json
import logging
import random
import time
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

# URL paths the site uses for the gallery files (root-relative)
IMAGES_URL_PATH = "/assets/images/gallery/images"

# main.js lines between these markers are replaced with the gallery items
ITEMS_START_MARKER = "// gallery-items:start"
ITEMS_END_MARKER = "// gallery-items:end"

STATE_FILE = REPO_DIR / ".instagram_state.json"
LOG_FILE = REPO_DIR / ".instagram_sync.log"

INSTAGRAM_USERNAME = os.environ.get("INSTA_USERNAME")
INSTAGRAM_PASSWORD = os.environ.get("INSTA_PASSWORD")
TARGET_PROFILE = INSTAGRAM_USERNAME

MAX_POSTS_TO_SCAN = 30
GALLERY_MAX_ITEMS = 9
ALT_TEXT_MAX_LENGTH = 120

# Throttling behaviour
PROFILE_LOAD_MAX_RETRIES = 6
PROFILE_LOAD_BACKOFF_BASE_SECONDS = 20
PROFILE_LOAD_BACKOFF_CAP_SECONDS = 15 * 60

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
    """Returns {shortcode: ISO post date or None} for posts already downloaded."""
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if "posts" in data:
                return dict(data["posts"])
            # Older state files only stored a list of shortcodes
            return {shortcode: None for shortcode in data.get("shortcodes", [])}
        except Exception as e:
            logging.warning("Failed to load state file: %s", e)
    return {}


def save_state(posts):
    STATE_FILE.write_text(
        json.dumps({"posts": dict(sorted(posts.items()))}, indent=2),
        encoding="utf-8"
    )


def download_image(url: str, dest: Path):
    # Write to a temporary file first so a failed download never leaves a partial image
    tmp = dest.with_suffix(dest.suffix + ".part")
    resp = requests.get(url, stream=True, timeout=30)
    resp.raise_for_status()
    with tmp.open("wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
    tmp.replace(dest)


def alt_text_from_caption(caption: str) -> str:
    first_line = next((line.strip() for line in caption.splitlines() if line.strip()), "")
    if not first_line:
        return "Instagram post"
    if len(first_line) > ALT_TEXT_MAX_LENGTH:
        first_line = first_line[:ALT_TEXT_MAX_LENGTH - 1].rstrip() + "…"
    return first_line


def build_gallery_items_from_local_files(posts):

    items = []

    for img_path in IMAGES_DIR.glob("*.jpg"):
        shortcode = img_path.stem
        desc_path = DESCS_DIR / f"{shortcode}.txt"
        if not desc_path.exists():
            continue

        # Prefer the post date; fall back to the file time for posts synced
        # before dates were recorded
        posted = posts.get(shortcode)
        sort_key = posted or datetime.fromtimestamp(img_path.stat().st_mtime).isoformat()

        items.append({
            "src": f"{IMAGES_URL_PATH}/{img_path.name}",
            "url": f"https://www.instagram.com/p/{shortcode}/",
            "alt": alt_text_from_caption(desc_path.read_text(encoding="utf-8")),
            "sort_key": sort_key,
        })

    items.sort(key=lambda x: x["sort_key"], reverse=True)
    return items[:GALLERY_MAX_ITEMS]


def update_main_js_items_block(posts):

    if not MAIN_JS.exists():
        logging.error("main.js not found at %s", MAIN_JS)
        return

    js = MAIN_JS.read_text(encoding="utf-8")

    idx_start = js.find(ITEMS_START_MARKER)
    idx_end = js.find(ITEMS_END_MARKER)
    if idx_start == -1 or idx_end == -1 or idx_end < idx_start:
        logging.error("Could not find %s / %s markers in main.js", ITEMS_START_MARKER, ITEMS_END_MARKER)
        return

    gallery_items = build_gallery_items_from_local_files(posts)
    if not gallery_items:
        logging.warning("No synced gallery images found; leaving main.js unchanged")
        return
    logging.info("Updating main.js items array with %d entries", len(gallery_items))

    # Match the indentation of the start marker line
    line_start = js.rfind("\n", 0, idx_start) + 1
    indent = js[line_start:idx_start]

    # json.dumps produces valid, safely escaped JavaScript string literals
    lines = [
        f"{indent}  {{ src: {json.dumps(it['src'])}, url: {json.dumps(it['url'])}, alt: {json.dumps(it['alt'])} }},"
        for it in gallery_items
    ]
    new_block = (
        f"{ITEMS_START_MARKER}\n"
        f"{indent}const items = [\n"
        + "\n".join(lines) + "\n"
        f"{indent}];\n"
        f"{indent}"
    )
    updated_js = js[:idx_start] + new_block + js[idx_end:]

    MAIN_JS.write_text(updated_js, encoding="utf-8")
    logging.info("main.js updated: %s", MAIN_JS)


def is_throttle_error(exc: Exception) -> bool:

    msg = str(exc)
    needles = [
        "Please wait a few minutes",
        "401 Unauthorized",
        "429",
        "Too Many Requests",
        "rate limited",
    ]
    return any(n in msg for n in needles)


def backoff_sleep(attempt: int):

    base = PROFILE_LOAD_BACKOFF_BASE_SECONDS * (2 ** attempt)
    seconds = min(PROFILE_LOAD_BACKOFF_CAP_SECONDS, base) + random.randint(0, 20)
    logging.warning("Instagram throttling detected. Backing off for %d seconds...", seconds)
    time.sleep(seconds)


def login_with_session(L: instaloader.Instaloader) -> bool:

    # Try existing session first
    try:
        L.load_session_from_file(INSTAGRAM_USERNAME)
        logging.info("Loaded existing Instagram session for %s", INSTAGRAM_USERNAME)
        return True
    except Exception:
        logging.info("No saved session found (or failed to load). Attempting fresh login...")

    # Fresh login
    try:
        L.login(INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD)
        L.save_session_to_file()
        logging.info("Logged in and saved new Instagram session.")
        return True
    except Exception as e:
        logging.error("Instagram login failed: %s", e)
        return False


def load_profile_with_backoff(L: instaloader.Instaloader):

    last_exc = None
    for attempt in range(PROFILE_LOAD_MAX_RETRIES):
        try:
            return Profile.from_username(L.context, TARGET_PROFILE)
        except Exception as e:
            last_exc = e
            if is_throttle_error(e):
                backoff_sleep(attempt)
                continue
            raise

    logging.error("Failed to load profile after retries due to throttling: %s", last_exc)
    return None

# ============= WHERE THE MAGIC HAPPENS =============

def main():
    ensure_dirs()

    if not INSTAGRAM_USERNAME or not INSTAGRAM_PASSWORD:
        logging.error("Missing INSTA_USERNAME / INSTA_PASSWORD environment variables.")
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

    if not login_with_session(L):
        return

    profile = load_profile_with_backoff(L)
    if profile is None:
        return

    known = load_state()
    new_shortcodes = []

    for count, post in enumerate(profile.get_posts()):
        if MAX_POSTS_TO_SCAN is not None and count >= MAX_POSTS_TO_SCAN:
            break

        shortcode = post.shortcode
        if known.get(shortcode):
            continue
        if shortcode in known:
            # Already downloaded by an older version of this script; just record the date
            known[shortcode] = post.date_utc.isoformat()
            continue

        logging.info("New post found: %s", shortcode)
        new_shortcodes.append(shortcode)

        img_path = IMAGES_DIR / f"{shortcode}.jpg"
        txt_path = DESCS_DIR / f"{shortcode}.txt"

        try:
            download_image(post.url, img_path)
            caption = post.caption or ""
            txt_path.write_text(caption, encoding="utf-8")
            known[shortcode] = post.date_utc.isoformat()
        except Exception as e:
            # If throttled mid-run, bail out
            if is_throttle_error(e):
                logging.warning("Throttled while downloading. Stopping this run: %s", e)
                break
            logging.error("Failed downloading %s: %s", shortcode, e)

    save_state(known)

    update_main_js_items_block(known)

    logging.info("Done. New posts this run: %d", len(new_shortcodes))

if __name__ == "__main__":
    main()
