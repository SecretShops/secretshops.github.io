#!/usr/bin/env python3
"""
Completa nombres, descripciones e imágenes de AliExpress mediante
el endpoint público de metadatos de Microlink.

La selección prioriza siempre productos nunca consultados. Los productos
que fallen se guardan en un historial separado y no vuelven a consumir
cuota hasta que venza su periodo de espera.
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
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "aliexpress-mx-source.json"
CACHE = ROOT / "data" / "aliexpress-mx-metadata-cache.json"
ATTEMPTS = ROOT / "data" / "aliexpress-mx-attempts.json"

MICROLINK_ENDPOINT = "https://api.microlink.io/"

MAX_PER_RUN = max(
    1,
    min(
        int(os.environ.get("MAX_PRODUCTS_PER_RUN", "20")),
        24,
    ),
)

# Espera antes de volver a consultar un producto que haya fallado.
# Primer fallo: 7 días; siguientes: 14, 30 y 60 días.
RETRY_DELAYS_DAYS = (7, 14, 30, 60)

GENERIC_TITLES = {
    "aliexpress",
    "aliexpress.com",
    "shopping online",
    "access denied",
    "page not found",
}

def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def save_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


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
        title = (
            title[:125]
            .rsplit(" ", 1)[0]
            .rstrip(" ,.-")
            + "…"
        )

    return title


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
            "User-Agent": "SecretShop-Catalog-Updater/3.0",
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=55,
    ) as response:
        payload = json.loads(
            response.read().decode("utf-8")
        )

    if payload.get("status") != "success":
        raise RuntimeError(
            payload.get("message")
            or (
                "Microlink devolvió estado "
                f"{payload.get('status')}"
            )
        )

    data = payload.get("data")

    if not isinstance(data, dict):
        raise RuntimeError("Respuesta sin objeto data")

    return data


def parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(
            str(value).replace("Z", "+00:00")
        )
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def is_completed(metadata: Any) -> bool:
    return (
        isinstance(metadata, dict)
        and bool(metadata.get("image"))
        and valid_title(metadata.get("title"))
    )


def retry_delay(attempt_number: int) -> timedelta:
    index = min(
        max(attempt_number - 1, 0),
        len(RETRY_DELAYS_DAYS) - 1,
    )
    return timedelta(
        days=RETRY_DELAYS_DAYS[index]
    )


def is_retryable(
    attempt: Any,
    now: datetime,
) -> bool:
    if not isinstance(attempt, dict):
        return False

    if attempt.get("status") != "failed":
        return False

    retry_after = parse_datetime(
        attempt.get("retry_after")
    )

    return retry_after is None or retry_after <= now


def select_products(
    sources: list[dict[str, Any]],
    cache: dict[str, Any],
    attempts: dict[str, Any],
    now: datetime,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    """
    Devuelve:
    - seleccionados;
    - productos nunca consultados;
    - fallos cuyo periodo de espera ya terminó.

    Los nunca consultados tienen prioridad absoluta sobre los reintentos.
    """
    never_attempted = []
    retryable = []

    for source in sources:
        product_id = source["product_id"]

        if is_completed(cache.get(product_id)):
            continue

        attempt = attempts.get(product_id)

        if not isinstance(attempt, dict):
            never_attempted.append(source)
            continue

        if is_retryable(attempt, now):
            retryable.append(source)

    selected = (
        never_attempted + retryable
    )[:MAX_PER_RUN]

    return selected, never_attempted, retryable


def main() -> int:
    sources = load_json(SOURCE, [])
    cache = load_json(CACHE, {})
    attempts = load_json(ATTEMPTS, {})

    if not isinstance(sources, list) or not sources:
        print(
            "No se encontró la fuente de productos.",
            file=sys.stderr,
        )
        return 2

    if not isinstance(cache, dict):
        cache = {}

    if not isinstance(attempts, dict):
        attempts = {}

    now = datetime.now(timezone.utc)

    selected, never_attempted, retryable = (
        select_products(
            sources,
            cache,
            attempts,
            now,
        )
    )

    print(
        "Productos nunca consultados: "
        f"{len(never_attempted)}"
    )
    print(
        "Fallos disponibles para reintento: "
        f"{len(retryable)}"
    )
    print(
        "Productos seleccionados: "
        f"{len(selected)}"
    )
    print()

    successes = 0
    failures = 0

    for index, source in enumerate(
        selected,
        start=1,
    ):
        product_id = source["product_id"]
        previous_attempt = attempts.get(
            product_id,
            {},
        )
        attempt_number = (
            int(
                previous_attempt.get(
                    "attempts",
                    0,
                )
            )
            + 1
        )

        attempt_time = datetime.now(
            timezone.utc
        )

        try:
            metadata = request_metadata(
                source["original_url"]
            )
            image = get_image(metadata)
            title = clean_title(
                metadata.get("title"),
                product_id,
            )

            if not image or not valid_title(title):
                raise RuntimeError(
                    "No se obtuvo un título "
                    "o una imagen válidos"
                )

            cache[product_id] = {
                "title": title,
                "description": normalize_text(
                    metadata.get("description")
                ),
                "image": image,
                "_updated_at":
                    attempt_time.isoformat(),
            }

            attempts[product_id] = {
                "status": "success",
                "attempts": attempt_number,
                "last_attempt_at":
                    attempt_time.isoformat(),
                "last_error": "",
                "retry_after": None,
            }

            successes += 1
            print(
                f"[{index}/{len(selected)}] OK "
                f"{product_id}: {title}"
            )

        except Exception as exc:
            delay = retry_delay(
                attempt_number
            )
            retry_after = (
                attempt_time + delay
            )

            attempts[product_id] = {
                "status": "failed",
                "attempts": attempt_number,
                "last_attempt_at":
                    attempt_time.isoformat(),
                "last_error": str(exc)[:500],
                "retry_after":
                    retry_after.isoformat(),
            }

            failures += 1
            print(
                f"[{index}/{len(selected)}] ERROR "
                f"{product_id}: {exc} · "
                f"Reintento desde "
                f"{retry_after.date().isoformat()}",
                file=sys.stderr,
            )

        # Guardado incremental: si la ejecución se interrumpe,
        # conserva lo que ya se haya procesado.
        save_json(CACHE, cache)
        save_json(ATTEMPTS, attempts)

        time.sleep(1.2)

    completed = sum(
        1
        for source in sources
        if is_completed(
            cache.get(source["product_id"])
        )
    )

    never_attempted_after = sum(
        1
        for source in sources
        if (
            not is_completed(
                cache.get(source["product_id"])
            )
            and source["product_id"]
            not in attempts
        )
    )

    deferred_failures = sum(
        1
        for source in sources
        if (
            not is_completed(
                cache.get(source["product_id"])
            )
            and isinstance(
                attempts.get(source["product_id"]),
                dict,
            )
            and attempts[source["product_id"]]
                .get("status") == "failed"
            and not is_retryable(
                attempts[source["product_id"]],
                datetime.now(timezone.utc),
            )
        )
    )

    retryable_after = sum(
        1
        for source in sources
        if (
            not is_completed(
                cache.get(source["product_id"])
            )
            and is_retryable(
                attempts.get(source["product_id"]),
                datetime.now(timezone.utc),
            )
        )
    )

    save_json(CACHE, cache)
    save_json(ATTEMPTS, attempts)

    print()
    print(
        "Metadatos completados: "
        f"{completed}/{len(sources)}"
    )
    print(
        "Correctos en esta ejecución: "
        f"{successes}"
    )
    print(
        "Fallos en esta ejecución: "
        f"{failures}"
    )
    print(
        "Nunca consultados pendientes: "
        f"{never_attempted_after}"
    )
    print(
        "Fallos aplazados: "
        f"{deferred_failures}"
    )
    print(
        "Reintentos disponibles ahora: "
        f"{retryable_after}"
    )
    print(
        "Pendientes totales: "
        f"{len(sources) - completed}"
    )

    # Los fallos individuales no rompen el workflow:
    # el catálogo mantiene los datos provisionales.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
