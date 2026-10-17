"""Сборка рекламной главной в статический сайт (без бэкенда курса).

Рендерит шаблоны из PAGES (главная, 404; «Политика ПДн» и «Оферта» сейчас отключены) в готовый HTML,
копирует только те файлы из static/, на которые эти страницы реально ссылаются,
и кладёт robots.txt + sitemap.xml. Форма «Перезвоните мне» в сборке скрыта
(static_site=True), поэтому серверу нужен только nginx.

Запуск (из корня проекта, внутри контейнера — там есть зависимости и .env):
    docker compose exec web python deploy/landing/build_landing.py --site-url https://nailis.ru

Результат: dist/landing/ — это содержимое корня сайта для nginx.

GitHub Pages по адресу https://<user>.github.io/<repo>/ (сайт в подпапке):
    ... build_landing.py --site-url https://<user>.github.io/<repo> --base-path /<repo> --github-pages
Со своим доменом на GitHub Pages base-path не нужен, но нужен --cname:
    ... build_landing.py --site-url https://nailis.ru --github-pages --cname nailis.ru
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import unquote, urljoin

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from jinja2 import Environment, FileSystemLoader, select_autoescape  # noqa: E402

from core.templating import format_course_cover, format_price_rub  # noqa: E402
from services.course_access import INSTAGRAM_URL, TELEGRAM_BUY_URL  # noqa: E402
from services.lenta_service import list_lenta_clips  # noqa: E402
from services.testimonials import list_testimonials  # noqa: E402

STATIC = ROOT / "static"
PAGES = {
    # шаблон → путь страницы на сайте
    "index.html": "/",
    # «Политика ПДн» и «Оферта» временно не публикуются — тексты ещё под старую платформу:
    # "legal/privacy.html": "/privacy",
    # "legal/offer.html": "/offer",
    "static_404.html": None,  # 404.html в корне, nginx отдаёт её на неизвестные адреса
}
STATIC_REF = re.compile(r"""/static/[^"'\s)<>?#]+""")
# любой атрибут со значением от корня сайта (href, src, poster, data-src, data-poster, …)
# получает --base-path; "//cdn…" и "https://…" не трогаем
ROOT_ATTR = re.compile(r"""(\s[\w:-]+=")/(?!/)""")
CSS_ROOT_URL = re.compile(r"""url\((['"]?)/static/""")
CSS_URL = re.compile(r"""url\(\s*['"]?([^'")]+?)['"]?\s*\)""")


def asset_version() -> str:
    """Хэш всех CSS/JS проекта — меняется при любой правке, браузер берёт свежие файлы."""
    digest = hashlib.sha256()
    for path in sorted((STATIC / "css").rglob("*.css")) + sorted((STATIC / "js").rglob("*.js")):
        digest.update(path.read_bytes())
    return digest.hexdigest()[:10]


def render_pages(site_url: str, version: str, noindex: bool = False) -> dict[str, str]:
    env = Environment(
        loader=FileSystemLoader(str(ROOT / "templates")),
        autoescape=select_autoescape(["html", "xml"]),
    )
    env.filters["rub"] = format_price_rub
    env.filters["course_cover"] = format_course_cover
    testimonials = list_testimonials(include_samples=False)  # только настоящие отзывы
    context = {
        "request": SimpleNamespace(url=SimpleNamespace(path="/")),
        "user": None,
        "static_site": True,
        "noindex": noindex,
        "site_url": site_url,
        "asset_v": version,
        "dev_live_reload": False,
        "csrf_token": "",
        "hero_clips": list_lenta_clips(),
        "testimonials": testimonials,
        "testimonials_demo": False,
        "telegram_url": TELEGRAM_BUY_URL,
        "instagram_url": INSTAGRAM_URL,
    }
    return {name: env.get_template(name).render(**context) for name in PAGES}


def static_refs_in(text: str) -> set[str]:
    return {unquote(ref) for ref in STATIC_REF.findall(text)}


def collect_assets(html_pages: list[str]) -> tuple[set[str], list[str]]:
    """Все /static/... из HTML плюс то, на что ссылаются найденные CSS (шрифты, фоны)."""
    pending = set().union(*(static_refs_in(html) for html in html_pages))
    found: set[str] = set()
    missing: list[str] = []
    while pending:
        ref = pending.pop()
        if ref in found:
            continue
        path = ROOT / ref.lstrip("/")
        if not path.is_file():
            missing.append(ref)
            continue
        found.add(ref)
        if path.suffix == ".css":
            for raw in CSS_URL.findall(path.read_text(encoding="utf-8")):
                if raw.startswith(("data:", "http:", "https:", "#")):
                    continue
                resolved = unquote(urljoin(ref, raw).split("?")[0].split("#")[0])
                if resolved.startswith("/static/") and resolved not in found:
                    pending.add(resolved)
    return found, sorted(set(missing))


def with_base_path(html: str, base: str) -> str:
    """/static/x, /privacy, / → <base>/static/x, <base>/privacy, <base>/ (сайт в подпапке)."""
    return ROOT_ATTR.sub(lambda m: f"{m.group(1)}{base}/", html) if base else html


def write_extras(out: Path, site_url: str, noindex: bool = False) -> None:
    today = date.today().isoformat()
    urls = "".join(
        f"  <url><loc>{site_url}{path}</loc><lastmod>{today}</lastmod></url>\n"
        for path in PAGES.values() if path
    )
    (out / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "</urlset>\n",
        encoding="utf-8",
    )
    (out / "robots.txt").write_text(
        "User-agent: *\nDisallow: /\n" if noindex
        else f"User-agent: *\nAllow: /\n\nSitemap: {site_url}/sitemap.xml\n",
        encoding="utf-8",
    )
    shutil.copy2(STATIC / "images" / "icons" / "favicon-32.png", out / "favicon.png")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site-url", required=True, help="адрес сайта, например https://nailis.ru")
    parser.add_argument("--out", default=str(ROOT / "dist" / "landing"), help="куда собрать (по умолчанию dist/landing)")
    parser.add_argument("--base-path", default="", help="подпапка сайта, например /nailis для <user>.github.io/nailis")
    parser.add_argument("--github-pages", action="store_true", help="добавить .nojekyll (и CNAME при --cname)")
    parser.add_argument("--cname", default="", help="свой домен для GitHub Pages, например nailis.ru")
    parser.add_argument("--noindex", action="store_true", help="тестовая копия: запретить поисковикам индексировать")
    args = parser.parse_args()

    site_url = args.site_url.rstrip("/")
    if not site_url.startswith("https://"):
        print("site-url должен начинаться с https://", file=sys.stderr)
        return 2
    base = "/" + args.base_path.strip("/") if args.base_path.strip("/") else ""
    if base and not site_url.endswith(base):
        print(f"site-url должен заканчиваться base-path ({base}): например https://user.github.io{base}", file=sys.stderr)
        return 2
    out = Path(args.out).resolve()
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    version = asset_version()
    rendered = render_pages(site_url, version, noindex=args.noindex)
    for template, page_path in PAGES.items():
        target = out / "404.html" if page_path is None else out / page_path.strip("/") / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(with_base_path(rendered[template], base), encoding="utf-8")

    assets, missing = collect_assets(list(rendered.values()))
    total = 0
    for ref in sorted(assets):
        src = ROOT / ref.lstrip("/")
        dst = out / ref.lstrip("/")
        dst.parent.mkdir(parents=True, exist_ok=True)
        if base and src.suffix == ".css":
            css = src.read_text(encoding="utf-8")
            dst.write_text(CSS_ROOT_URL.sub(lambda m: f"url({m.group(1)}{base}/static/", css), encoding="utf-8")
        else:
            shutil.copy2(src, dst)
        total += src.stat().st_size
    write_extras(out, site_url, noindex=args.noindex)
    if args.github_pages:
        (out / ".nojekyll").write_text("", encoding="utf-8")  # не прогонять сайт через Jekyll
        if args.cname:
            (out / "CNAME").write_text(args.cname.strip() + "\n", encoding="utf-8")

    print(f"Страниц: {len(PAGES)}, файлов из static: {len(assets)}, вес: {total / 1024 / 1024:.1f} МБ")
    print(f"Версия CSS/JS: {version}")
    if args.noindex:
        print("Индексация запрещена (noindex) — тестовая копия")
    print(f"Готово: {out}")
    if missing:
        print("\nНЕ НАЙДЕНЫ (страница на них ссылается):", file=sys.stderr)
        for ref in missing:
            print("  " + ref, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
