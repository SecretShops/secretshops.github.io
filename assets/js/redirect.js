const AMAZON_ASSOCIATE_TAG = "christian0ddd-21";

function fail(text) {
  const title = document.querySelector("[data-redirect-title]");
  const message = document.querySelector("[data-redirect-message]");
  const back = document.querySelector("[data-redirect-back]");
  const loader = document.querySelector(".redirect-loader");
  title.textContent = "No se pudo abrir esta oferta";
  message.textContent = text;
  back.hidden = false;
  loader.hidden = true;
}

export function allowedDestination(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const awin =
      /(^|\.)awin1\.com$/i.test(url.hostname) &&
      ["/pclick.php", "/cread.php"].includes(url.pathname) &&
      ["a", "p", "m"].every((key) => url.searchParams.get(key));
    const aliexpress = /^s\.click\.aliexpress\.com$/i.test(url.hostname);
    const amazon =
      /^(?:www\.)?amazon\.es$/i.test(url.hostname) &&
      /^\/dp\/[A-Z0-9]{10}\/ref=nosim\/?$/i.test(url.pathname) &&
      url.searchParams.get("tag") === AMAZON_ASSOCIATE_TAG;
    return awin || aliexpress || amazon ? url.href : null;
  } catch {
    return null;
  }
}

async function redirect() {
  const offerId = new URLSearchParams(location.search).get("offer")?.trim();
  if (!offerId || offerId.length > 200) {
    fail("La oferta indicada no es válida o ya no está disponible.");
    return;
  }

  try {
    const response = await fetch("./data/catalog/affiliate-links.json", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("No se pudo comprobar el catálogo.");
    const payload = await response.json();
    const entry = payload?.links?.[offerId];
    const destination = allowedDestination(entry?.url);
    if (!destination) {
      fail("La oferta no está publicada o su enlace no supera la verificación.");
      return;
    }

    try {
      sessionStorage.setItem(
        "secretshop:last-outbound:v1",
        JSON.stringify({
          offerId,
          merchantId: entry.merchantId,
          country: entry.country,
          at: new Date().toISOString()
        })
      );
    } catch {}

    location.replace(destination);
  } catch {
    fail("No hemos podido verificar el enlace. Vuelve al catálogo e inténtalo de nuevo.");
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  redirect();
}
