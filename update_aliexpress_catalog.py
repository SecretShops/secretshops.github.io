#!/usr/bin/env python3
"""
Actualiza catalog-aliexpress-mx.js usando la API oficial de AliExpress.

Credenciales requeridas:
- ALIEXPRESS_APP_KEY
- ALIEXPRESS_APP_SECRET

El secreto solo se usa durante GitHub Actions. Nunca se escribe en la web.
"""

from __future__ import annotations

import csv
import hashlib
import hmac
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "aliexpress-mx-products.csv"
CACHE = ROOT / "data" / "aliexpress-mx-cache.json"
OUTPUT = ROOT / "catalog-aliexpress-mx.js"

API_URL = os.environ.get(
    "ALIEXPRESS_API_URL",
    "https://eco.taobao.com/router/rest",
)
APP_KEY = os.environ.get("ALIEXPRESS_APP_KEY", "").strip()
APP_SECRET = os.environ.get("ALIEXPRESS_APP_SECRET", "").strip()

DEFAULT_IMAGE = (
    "https://placehold.co/900x900/111821/d6ad52"
    "?text=Atlas+Secreto"
)

DESCRIPTION_BY_CATEGORY = {
    "Moda mujer":
        "Artículo de moda femenina seleccionado por Atlas Secreto. "
        "Consulta tallas, colores, composición, envío y disponibilidad.",
    "Accesorios mujer":
        "Accesorio femenino seleccionado por su utilidad y precio. "
        "Revisa variantes, materiales y medidas antes de comprar.",
    "Accesorios hombre":
        "Accesorio masculino seleccionado por Atlas Secreto. "
        "Consulta materiales, medidas y variantes disponibles.",
    "Moda hombre":
        "Artículo de moda masculina seleccionado por Atlas Secreto. "
        "Consulta tallas, colores, materiales y disponibilidad.",
    "Hogar":
        "Producto práctico para el hogar seleccionado por Atlas Secreto. "
        "Revisa medidas, materiales y variantes disponibles.",
    "Tecnología":
        "Gadget tecnológico seleccionado por Atlas Secreto. "
        "Comprueba especificaciones, compatibilidad y variantes.",
    "Virales":
        "Producto popular seleccionado por Atlas Secreto. "
        "Consulta características, variantes, envío y precio vigente.",
    "Menos de 10":
        "Producto económico seleccionado por Atlas Secreto. "
        "El precio puede variar según versión, cupones y entrega.",
    "Belleza y cuidado":
        "Producto de belleza y cuidado seleccionado por Atlas Secreto. "
        "Revisa ingredientes, modo de uso y advertencias del vendedor.",
    "Aventura y viajes":
        "Accesorio seleccionado para viajes y actividades al aire libre. "
        "Comprueba medidas, resistencia y condiciones de envío.",
    "Coche/Moto":
        "Accesorio seleccionado para coche o moto. "
        "Verifica la compatibilidad exacta con tu modelo.",
}

def sign_request(params: dict[str, str], secret: str) -> str:
    joined = "".join(
        f"{key}{params[key]}"
        for key in sorted(params)
        if key != "sign" and params[key] not in ("", None)
    )
    return hmac.new(
        secret.encode("utf-8"),
        joined.encode("utf-8"),
        hashlib.md5,
    ).hexdigest().upper()

def top_timestamp() -> str:
    # TOP usa GMT+8 y acepta una diferencia máxima de 10 minutos.
    tz = timezone(timedelta(hours=8))
    return datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S")

def request_product(product_id: str) -> dict[str, Any]:
    params = {
        "method": "aliexpress.offer.productdisplay.query",
        "app_key": APP_KEY,
        "timestamp": top_timestamp(),
        "format": "json",
        "v": "2.0",
        "sign_method": "hmac",
        "simplify": "true",
        "product_id": product_id,
        "local_country": "MX",
        "local_language": "es",
    }
    params["sign"] = sign_request(params, APP_SECRET)

    body = urllib.parse.urlencode(params).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=body,
        headers={
            "Content-Type":
                "application/x-www-form-urlencoded;charset=utf-8",
            "User-Agent": "Atlas-Secreto-Catalog-Updater/1.0",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=35) as response:
        data = json.loads(response.read().decode("utf-8"))

    if "error_response" in data:
        error = data["error_response"]
        raise RuntimeError(
            f"{error.get('code', '')} "
            f"{error.get('msg', 'Error de API')} "
            f"{error.get('sub_msg', '')}".strip()
        )

    root = data.get(
        "aliexpress_offer_productdisplay_query_response",
        data,
    )
    result = root.get("result") or {}
    if not isinstance(result, dict) or not result:
        raise RuntimeError("Respuesta sin datos de producto")
    return result

def first_image(value: Any) -> str:
    candidates: list[str] = []

    if isinstance(value, str):
        stripped = value.strip()
        if stripped:
            try:
                decoded = json.loads(stripped)
                if decoded != value:
                    return first_image(decoded)
            except (json.JSONDecodeError, TypeError):
                pass
            candidates.extend(
                re.split(r"[|;,]\s*|\s+(?=https?://)", stripped)
            )
    elif isinstance(value, list):
        for item in value:
            candidates.extend(first_image(item).splitlines())
    elif isinstance(value, dict):
        for item in value.values():
            candidate = first_image(item)
            if candidate:
                candidates.append(candidate)

    for candidate in candidates:
        candidate = candidate.strip().strip('"')
        if candidate.startswith("//"):
            candidate = "https:" + candidate
        if candidate.startswith(("https://", "http://")):
            return candidate
    return ""

def clean_title(value: Any, product_id: str) -> str:
    title = html.unescape(str(value or ""))
    title = re.sub(r"<[^>]+>", " ", title)
    title = re.sub(r"\s+", " ", title).strip(" -_|,")
    if not title:
        return f"Producto AliExpress {product_id}"

    if len(title) > 105:
        shortened = title[:105].rsplit(" ", 1)[0].rstrip(" ,.-")
        title = shortened + "…"
    return title

def number_from_value(value: Any) -> float | None:
    if value in (None, ""):
        return None
    match = re.search(r"-?\d+(?:[.,]\d+)?", str(value))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", "."))
    except ValueError:
        return None

def display_price(result: dict[str, Any]) -> tuple[str, float | None, str]:
    currency = str(result.get("currency_code") or "MXN").upper()

    direct = result.get("item_offer_site_sale_price")
    numeric = number_from_value(direct)
    if numeric is not None:
        if re.search(r"[A-Za-z$€£¥]", str(direct)):
            return str(direct).strip(), numeric, currency
        return f"{numeric:,.2f} {currency}", numeric, currency

    cents = number_from_value(result.get("discount_price_cents"))
    if cents is not None:
        numeric = cents / 100
        return f"{numeric:,.2f} {currency}", numeric, currency

    original = result.get("product_price")
    numeric = number_from_value(original)
    if numeric is not None:
        if re.search(r"[A-Za-z$€£¥]", str(original)):
            return str(original).strip(), numeric, currency
        return f"{numeric:,.2f} {currency}", numeric, currency

    return "Ver precio actual", None, currency

def load_cache() -> dict[str, Any]:
    if not CACHE.exists():
        return {}
    try:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}

def description_for(categories: list[str]) -> str:
    primary = categories[0] if categories else "Virales"
    return DESCRIPTION_BY_CATEGORY.get(
        primary,
        "Producto seleccionado por Atlas Secreto. "
        "Consulta variantes, características, envío y disponibilidad.",
    )

def make_product(
    source: dict[str, str],
    api_data: dict[str, Any] | None,
    cached: dict[str, Any] | None,
) -> dict[str, Any]:
    product_id = source["product_id"]
    categories = [
        item for item in source["categories"].split("|") if item
    ]

    metadata = api_data or cached or {}

    title = clean_title(
        metadata.get("subject")
        or metadata.get("english_subject")
        or metadata.get("name"),
        product_id,
    )

    image = (
        first_image(metadata.get("image_urls"))
        or str(metadata.get("image") or "").strip()
        or DEFAULT_IMAGE
    )

    if api_data:
        price_text, numeric_price, price_currency = display_price(api_data)
    else:
        numeric_price = number_from_value(
            source.get("snapshot_sale_price")
        )
        price_currency = source.get("snapshot_currency") or "USD"
        price_text = (
            f"Desde {numeric_price:,.2f} {price_currency}"
            if numeric_price is not None
            else "Ver precio actual"
        )

    return {
        "id": f"aliexpress-{product_id}",
        "name": title,
        "description": description_for(categories),
        "categories": categories,
        "image": image,
        "featured": "Virales" in categories,
        "createdAt": datetime.now().date().isoformat(),
        "offers": [
            {
                "store": "AliExpress",
                "country": "MX",
                "price": price_text,
                "url": source["tracking_url"],
            }
        ],
        "_cache": {
            "name": title,
            "image": image,
            "price": price_text,
            "numeric_price": numeric_price,
            "currency": price_currency,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    }

def main() -> int:
    if not APP_KEY or not APP_SECRET:
        print(
            "Faltan ALIEXPRESS_APP_KEY o ALIEXPRESS_APP_SECRET.",
            file=sys.stderr,
        )
        return 2

    with SOURCE.open("r", encoding="utf-8-sig", newline="") as handle:
        sources = list(csv.DictReader(handle))

    previous_cache = load_cache()
    next_cache: dict[str, Any] = dict(previous_cache)
    output_products: list[dict[str, Any]] = []
    successes = 0
    failures = 0

    for index, source in enumerate(sources, start=1):
        product_id = source["product_id"]
        api_data: dict[str, Any] | None = None

        try:
            api_data = request_product(product_id)
            successes += 1
            print(f"[{index}/{len(sources)}] OK {product_id}")
        except Exception as exc:
            failures += 1
            print(
                f"[{index}/{len(sources)}] ERROR {product_id}: {exc}",
                file=sys.stderr,
            )

        product = make_product(
            source,
            api_data,
            previous_cache.get(product_id),
        )
        next_cache[product_id] = product.pop("_cache")
        output_products.append(product)
        time.sleep(0.18)

    if successes == 0:
        print(
            "No se pudo actualizar ningún producto. "
            "El catálogo existente no se modificará.",
            file=sys.stderr,
        )
        return 3

    header = (
        '"use strict";\n\n'
        "/*\n"
        "  CATÁLOGO ALIEXPRESS · MÉXICO\n"
        f"  Actualizado automáticamente: "
        f"{datetime.now(timezone.utc).isoformat()}\n"
        f"  API correctos: {successes}; fallos con fallback: {failures}.\n"
        "*/\n\n"
        "window.CATALOG_ALIEXPRESS_MX = "
    )

    temporary = OUTPUT.with_suffix(".js.tmp")
    temporary.write_text(
        header
        + json.dumps(output_products, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    temporary.replace(OUTPUT)

    CACHE.write_text(
        json.dumps(next_cache, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        f"Catálogo generado: {len(output_products)} productos únicos."
    )
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
