#!/usr/bin/env python3
"""Construye el catálogo público familias → variantes → ofertas.

Los archivos products.json y offers.json siguen siendo la fuente canónica.
El archivo público no incluye enlaces de afiliación: solo conserva el ID de
oferta que resuelve go.html mediante affiliate-links.json.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOG_DIR = ROOT / "data" / "catalog"
PRODUCTS_PATH = CATALOG_DIR / "products.json"
OFFERS_PATH = CATALOG_DIR / "offers.json"
MERCHANTS_PATH = CATALOG_DIR / "merchants.json"
FAMILIES_PATH = CATALOG_DIR / "families.json"
REPORT_PATH = CATALOG_DIR / "family-grouping-report.json"

COLORS = (
    "beige",
    "gris",
    "antracita",
    "negro",
    "negra",
    "blanco",
    "blanca",
    "crema",
    "marrón",
    "marron",
    "verde",
    "azul",
    "rojo",
    "rosa",
    "amarillo",
    "naranja",
    "taupe",
    "cognac",
    "plateado",
    "plata",
    "dorado",
)
ORIENTATIONS = ("izquierda", "derecha", "izquierdo", "derecho")
HIDDEN_AVAILABILITY = {"out_of_stock", "unavailable", "discontinued"}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path: Path, payload: Any, *, pretty: bool = False) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    options: dict[str, Any] = {
        "ensure_ascii": False,
    }
    if pretty:
        options["indent"] = 2
    else:
        options["separators"] = (",", ":")
    temporary.write_text(json.dumps(payload, **options) + "\n", encoding="utf-8")
    temporary.replace(path)


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\b\d+(?:[.,]\d+)?\s*(?:cm|mm|m|plazas?|piezas?)\b", " ", text)
    removable = "|".join(map(re.escape, (*COLORS, *ORIENTATIONS)))
    text = re.sub(rf"\b(?:{removable})\b", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def slugify(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", normalize(value)).strip("-")[:90]


def first_attribute(title: str, values: tuple[str, ...]) -> str | None:
    lowered = title.lower()
    return next(
        (value for value in values if re.search(rf"\b{re.escape(value)}\b", lowered)),
        None,
    )


def offer_total(offer: dict[str, Any]) -> float | None:
    if isinstance(offer.get("totalPrice"), (int, float)):
        return float(offer["totalPrice"])
    if not isinstance(offer.get("price"), (int, float)):
        return None
    price = float(offer["price"])
    shipping = offer.get("shippingCost")
    return price + (float(shipping) if isinstance(shipping, (int, float)) else 0)


def offer_sort_key(offer: dict[str, Any]) -> tuple[bool, float]:
    total = offer_total(offer)
    return (total is None, total if total is not None else float("inf"))


def public_offer(
    offer: dict[str, Any],
    merchant_names: dict[str, str],
) -> dict[str, Any]:
    return {
        "id": offer["id"],
        "merchantId": offer["merchantId"],
        "merchantName": merchant_names.get(offer["merchantId"], offer["merchantId"]),
        "country": offer["country"],
        "currency": offer["currency"],
        "price": offer.get("price"),
        "previousPrice": offer.get("previousPrice"),
        "shippingCost": offer.get("shippingCost"),
        "totalPrice": offer_total(offer),
        "displayPrice": offer.get("displayPrice"),
        "availability": offer.get("availability", "unknown"),
        "condition": offer.get("condition", "new"),
        "deliveryTime": offer.get("deliveryTime"),
        "updatedAt": offer.get("lastUpdatedAt"),
    }


def variant_label(
    product: dict[str, Any],
    color: str | None,
    orientation: str | None,
    dimensions: str | None,
    material: str | None,
) -> str:
    variant = product.get("variant") or {}
    values = [
        variant.get("size"),
        color,
        orientation,
        dimensions,
        variant.get("capacity"),
        material,
    ]
    labels: list[str] = []
    for value in values:
        cleaned = str(value or "").strip()
        if cleaned and cleaned not in labels:
            labels.append(cleaned)
    return " · ".join(labels[:3]) or "Modelo disponible"


def main() -> int:
    product_payload = read_json(PRODUCTS_PATH)
    offer_payload = read_json(OFFERS_PATH)
    merchant_payload = read_json(MERCHANTS_PATH)
    products = product_payload["products"]
    offers = offer_payload["offers"]
    merchant_names = {
        merchant["id"]: merchant["name"]
        for merchant in merchant_payload["merchants"]
    }

    offers_by_product: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for offer in offers:
        if (
            (
                (isinstance(offer.get("price"), (int, float)) and offer["price"] > 0)
                or bool(str(offer.get("displayPrice") or "").strip())
            )
            and isinstance(offer.get("affiliateUrl"), str)
            and offer["affiliateUrl"].startswith("https://")
            and offer.get("availability") not in HIDDEN_AVAILABILITY
        ):
            offers_by_product[offer["productId"]].append(offer)

    groups: dict[str, list[tuple[dict[str, Any], list[dict[str, Any]]]]] = defaultdict(list)
    hidden: list[dict[str, str]] = []

    for product in products:
        product_offers = offers_by_product.get(product["id"], [])
        reason = None
        if not product_offers:
            reason = "sin_oferta_publicable"
        elif not product.get("images"):
            reason = "sin_imagen"

        if reason:
            hidden.append({"productId": product["id"], "reason": reason})
            continue

        model = str(product.get("model") or "").strip()
        family_key = "|".join(
            [
                normalize(product.get("brand") or "sin marca"),
                normalize(product.get("category") or ""),
                normalize(model) if model else normalize(product["title"]),
            ]
        )
        product_type = normalize(
            (product.get("attributes") or {}).get("productType")
            or product.get("category")
            or ""
        )
        groups[f"{family_key}|{product_type}"].append((product, product_offers))

    families: list[dict[str, Any]] = []
    for group_key, items in groups.items():
        representative, _ = sorted(
            items,
            key=lambda item: (
                not any(offer.get("availability") == "in_stock" for offer in item[1]),
                -len(item[0].get("images") or []),
                min(offer_sort_key(offer) for offer in item[1]),
            ),
        )[0]

        variants: list[dict[str, Any]] = []
        all_totals: list[float] = []
        all_offers: list[dict[str, Any]] = []

        for product, product_offers in sorted(
            items,
            key=lambda item: min(offer_sort_key(offer) for offer in item[1]),
        ):
            title = product["title"]
            attributes = product.get("attributes") or {}
            variant = product.get("variant") or {}
            color = variant.get("color") or first_attribute(title, COLORS)
            orientation = variant.get("orientation") or first_attribute(
                title,
                ORIENTATIONS,
            )
            dimensions = attributes.get("dimensions")
            material = attributes.get("specifications")
            normalized_offers = sorted(
                (
                    public_offer(offer, merchant_names)
                    for offer in product_offers
                ),
                key=offer_sort_key,
            )
            all_offers.extend(normalized_offers)
            all_totals.extend(
                offer["totalPrice"]
                for offer in normalized_offers
                if isinstance(offer.get("totalPrice"), (int, float))
            )
            variants.append(
                {
                    "id": product["id"],
                    "title": title,
                    "label": variant_label(
                        product,
                        color,
                        orientation,
                        dimensions,
                        material,
                    ),
                    "color": color,
                    "size": variant.get("size"),
                    "orientation": orientation,
                    "dimensions": dimensions,
                    "material": material,
                    "capacity": variant.get("capacity"),
                    "configuration": variant.get("configuration"),
                    "images": (product.get("images") or [])[:5],
                    "offers": normalized_offers,
                }
            )

        family_id = "fam-" + hashlib.sha1(group_key.encode()).hexdigest()[:12]
        image_count = len(representative.get("images") or [])
        all_in_stock = all(
            offer["availability"] == "in_stock"
            for offer in all_offers
        )
        score = min(
            9.8,
            6.5
            + (1 if all_in_stock else 0.3)
            + min(1, image_count * 0.15)
            + (0.6 if len(variants) > 1 else 0.2),
        )
        brand = representative.get("brand") or "Selección"
        model = representative.get("model")
        family_title = f"{brand} {model}".strip() if model else representative["title"]
        families.append(
            {
                "id": family_id,
                "slug": slugify(family_title),
                "title": family_title,
                "brand": brand,
                "model": model,
                "category": representative.get("category"),
                "categories": representative.get("categories", []),
                "description": representative.get("description") or "",
                "image": (representative.get("images") or [None])[0],
                "images": (representative.get("images") or [])[:5],
                "minPrice": min(all_totals) if all_totals else None,
                "maxPrice": max(all_totals) if all_totals else None,
                "variantCount": len(variants),
                "secretScore": round(score, 1),
                "source": "feed",
                "variants": variants,
            }
        )

    families.sort(key=lambda family: (family.get("category") or "", family["title"]))
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat()
    report = {
        "generatedAt": generated_at,
        "sourceProducts": len(products),
        "sourceOffers": len(offers),
        "families": len(families),
        "variants": sum(family["variantCount"] for family in families),
        "publicOffers": sum(
            len(variant["offers"])
            for family in families
            for variant in family["variants"]
        ),
        "hidden": len(hidden),
        "sofaProducts": sum(
            1 for product in products if product.get("category") == "Sofás"
        ),
        "sofaFamilies": sum(
            1 for family in families if family.get("category") == "Sofás"
        ),
        "largestFamilies": sorted(
            (
                {
                    "id": family["id"],
                    "title": family["title"],
                    "variants": family["variantCount"],
                }
                for family in families
            ),
            key=lambda item: -item["variants"],
        )[:20],
        "policy": (
            "Agrupación conservadora por marca, categoría, modelo y tipo; "
            "las ofertas permanecen asociadas a una variante exacta."
        ),
    }

    write_json_atomic(
        FAMILIES_PATH,
        {
            "schemaVersion": 3,
            "generatedAt": generated_at,
            "families": families,
        },
    )
    write_json_atomic(
        REPORT_PATH,
        {
            "schemaVersion": 3,
            "report": report,
            "hiddenProducts": hidden,
        },
        pretty=True,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
