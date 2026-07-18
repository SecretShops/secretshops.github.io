#!/usr/bin/env python3
"""
Completa nombres, descripciones e imágenes de AliExpress mediante
el endpoint público de metadatos de Microlink.

No requiere App Key de AliExpress ni secretos.
El lote por defecto es de 20 productos por ejecución para respetar
la cuota diaria gratuita del proveedor.
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "aliexpress-mx-source.json"
CACHE = ROOT / "data" / "aliexpress-mx-metadata-cache.json"
OUTPUT = ROOT / "catalog-aliexpress-mx.js"

MICROLINK_ENDPOINT = "https://api.microlink.io/"
MAX_PER_RUN = max(
    1,
    min(
        int(os.environ.get("MAX_PRODUCTS_PER_RUN", "20")),
        24,
    ),
)

GENERIC_TITLES = {
    "aliexpress",
    "aliexpress.com",
    "shopping online",
    "access denied",
    "page not found",
}

CATEGORY_DESCRIPTION = {
    "Moda mujer":
        "Artículo de moda femenina disponible en distintas variantes. "
        "Consulta tallas, colores, materiales y condiciones de envío.",
    "Moda hombre":
        "Artículo de moda masculina disponible en distintas variantes. "
        "Consulta tallas, colores, materiales y condiciones de envío.",
    "Accesorios mujer":
        "Accesorio femenino disponible en distintas variantes. "
        "Revisa materiales, medidas y colores antes de comprar.",
    "Accesorios hombre":
        "Accesorio masculino disponible en distintas variantes. "
        "Revisa materiales, medidas y colores antes de comprar.",
    "Tecnología":
        "Producto tecnológico seleccionado por Atlas Secreto. "
        "Comprueba especificaciones, compatibilidad y variante.",
    "Hogar":
        "Producto práctico para el hogar. "
        "Revisa medidas, materiales y variante antes de comprar.",
    "Belleza y cuidado":
        "Producto de belleza y cuidado. "
        "Consulta composición, variante y modo de uso indicado por el vendedor.",
    "Aventura y viajes":
        "Accesorio para viajes o actividades al aire libre. "
        "Comprueba medidas, materiales y resistencia.",
    "Coche/Moto":
        "Accesorio para coche o moto. "
        "Verifica la compatibilidad exacta con tu modelo.",
    "Virales":
        "Producto popular seleccionado por Atlas Secreto. "
        "Consulta características, variantes y disponibilidad.",
    "Menos de 10":
        "Producto económico seleccionado por Atlas Secreto. "
        "El precio final puede variar según variante, cupones y entrega.",
}

def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default

def normalize_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" \t\r\n-|,.;")

def valid_title(value: Any) -> bool:
    title = normalize_text(value)
    if len(title) < 8:
        return False
    lowered = title.lower()
    return not any(item in lowered for item in GENERIC_TITLES)

def clean_title(value: Any, product_id: str) -> str:
    title = normalize_text(value)
    title = re.sub(
        r"\s*[-|]\s*AliExpress(?:\s+\d+)?\s*$",
        "",
        title,
        flags=re.IGNORECASE,
    )
    title = re.sub(
        r"^\s*AliExpress\s*[-|:]\s*",
        "",
        title,
        flags=re.IGNORECASE,
    )
    title = normalize_text(title)

    if not valid_title(title):
        return f"Producto AliExpress {product_id}"

    if len(title) > 125:
        title = title[:125].rsplit(" ", 1)[0].rstrip(" ,.-") + "…"

    return title

def valid_description(value: Any) -> bool:
    description = normalize_text(value)
    if len(description) < 20:
        return False
    lowered = description.lower()
    blocked = (
        "aliexpress offers",
        "smarter shopping",
        "access denied",
        "page not found",
        "cookie",
        "javascript",
    )
    return not any(item in lowered for item in blocked)

def build_description(
    title: str,
    raw_description: Any,
    categories: list[str],
) -> str:
    description = normalize_text(raw_description)

    if valid_description(description):
        if len(description) > 250:
            description = (
                description[:250]
                .rsplit(" ", 1)[0]
                .rstrip(" ,.-")
                + "…"
            )
        return description

    primary = categories[0] if categories else "Virales"
    fallback = CATEGORY_DESCRIPTION.get(
        primary,
        "Producto seleccionado por Atlas Secreto. "
        "Consulta características, variantes y disponibilidad.",
    )
    return f"{title}. {fallback}"

def get_image(metadata: dict[str, Any]) -> str:
    image = metadata.get("image")
    if isinstance(image, dict):
        url = str(image.get("url") or "").strip()
        width = int(image.get("width") or 0)
        height = int(image.get("height") or 0)
    else:
        url = str(image or "").strip()
        width = 0
        height = 0

    if url.startswith("//"):
        url = "https:" + url

    if not url.startswith(("https://", "http://")):
        return ""

    lowered = url.lower()
    if any(
        token in lowered
        for token in (
            "logo",
            "favicon",
            "icon",
            "sprite",
            "placeholder",
        )
    ):
        return ""

    if width and height and min(width, height) < 180:
        return ""

    return url

def request_metadata(url: str) -> dict[str, Any]:
    params = urllib.parse.urlencode(
        {
            "url": url,
            "meta": "true",
            "screenshot": "false",
            "video": "false",
            "audio": "false",
        }
    )
    request_url = f"{MICROLINK_ENDPOINT}?{params}"

    request = urllib.request.Request(
        request_url,
        headers={
            "Accept": "application/json",
            "User-Agent": "Atlas-Secreto-Catalog-Updater/1.0",
        },
    )

    with urllib.request.urlopen(request, timeout=55) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if payload.get("status") != "success":
        raise RuntimeError(
            payload.get("message")
            or f"Microlink devolvió estado {payload.get('status')}"
        )

    data = payload.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("Respuesta sin objeto data")

    return data

def build_product(
    source: dict[str, Any],
    metadata: dict[str, Any] | None,
) -> dict[str, Any]:
    product_id = source["product_id"]
    metadata = metadata or {}

    title_candidate = metadata.get("title")
    name = (
        clean_title(title_candidate, product_id)
        if valid_title(title_candidate)
        else source["fallback_name"]
    )

    image = get_image(metadata) or source["fallback_image"]

    description = build_description(
        name,
        metadata.get("description"),
        list(source.get("categories") or []),
    )

    offer = {
        "store": "AliExpress",
        "country": "MX",
        "price": source.get("price") or "Ver precio actual",
        "url": source["tracking_url"],
    }

    if source.get("priceSnapshot"):
        offer["priceSnapshot"] = source["priceSnapshot"]

    product = {
        "id": f"aliexpress-{product_id}",
        "name": name,
        "description": description,
        "categories": source.get("categories") or [],
        "image": image,
        "featured": bool(source.get("featured")),
        "createdAt": source.get("createdAt") or "2026-07-18",
        "offers": [offer],
    }

    if metadata:
        product["metadataUpdatedAt"] = metadata.get("_updated_at")
        product["metadataSource"] = "Microlink"

    return product

def main() -> int:
    sources = load_json(SOURCE, [])
    cache = load_json(CACHE, {})

    if not isinstance(sources, list) or not sources:
        print("No se encontró la fuente de productos.", file=sys.stderr)
        return 2

    if not isinstance(cache, dict):
        cache = {}

    pending = [
        item
        for item in sources
        if item["product_id"] not in cache
        or not cache[item["product_id"]].get("image")
        or not valid_title(cache[item["product_id"]].get("title"))
    ]

    selected = pending[:MAX_PER_RUN]
    successes = 0
    failures = 0

    for index, source in enumerate(selected, start=1):
        product_id = source["product_id"]

        try:
            metadata = request_metadata(source["original_url"])
            image = get_image(metadata)
            title = clean_title(metadata.get("title"), product_id)

            if not image or not valid_title(title):
                raise RuntimeError(
                    "No se obtuvo un título o una imagen válidos"
                )

            cache[product_id] = {
                "title": title,
                "description": normalize_text(
                    metadata.get("description")
                ),
                "image": image,
                "_updated_at": datetime.now(timezone.utc).isoformat(),
            }

            successes += 1
            print(
                f"[{index}/{len(selected)}] OK "
                f"{product_id}: {title}"
            )
        except Exception as exc:
            failures += 1
            print(
                f"[{index}/{len(selected)}] ERROR "
                f"{product_id}: {exc}",
                file=sys.stderr,
            )

        time.sleep(1.2)

    CACHE.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    products = [
        build_product(
            source,
            cache.get(source["product_id"]),
        )
        for source in sources
    ]

    completed = sum(
        1
        for source in sources
        if source["product_id"] in cache
        and cache[source["product_id"]].get("image")
        and valid_title(cache[source["product_id"]].get("title"))
    )

    header = (
        '"use strict";\n\n'
        "/*\n"
        "  CATÁLOGO ALIEXPRESS · MÉXICO\n\n"
        f"  Productos únicos: {len(products)}.\n"
        f"  Metadatos reales completados: {completed}/{len(products)}.\n"
        "  Los productos pendientes conservan sus datos provisionales.\n"
        "*/\n\n"
        "window.CATALOG_META_ALIEXPRESS_MX = {\n"
        f"  sourceRows: 100,\n"
        f"  uniqueProducts: {len(products)},\n"
        f"  duplicatesMerged: 40,\n"
        f'  updatedAt: "{datetime.now(timezone.utc).date().isoformat()}",\n'
        f"  metadataCompleted: {completed},\n"
        '  priceMode: "external"\n'
        "};\n\n"
        "window.CATALOG_ALIEXPRESS_MX = "
    )

    temporary = OUTPUT.with_suffix(".js.tmp")
    temporary.write_text(
        header
        + json.dumps(products, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    temporary.replace(OUTPUT)

    print()
    print(f"Metadatos completados: {completed}/{len(products)}")
    print(f"Correctos en esta ejecución: {successes}")
    print(f"Fallos en esta ejecución: {failures}")
    print(f"Pendientes: {len(products) - completed}")

    # No se considera error que algunos productos fallen:
    # el catálogo conserva sus datos provisionales.
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
