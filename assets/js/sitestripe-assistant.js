import {
  applyCapturedImages,
  extractAsin,
  parseCsv,
  parseSiteStripePayload,
  serializeCsv
} from "./sitestripe-assistant-core.js";

const SOURCE_URL = "./data/sources/amazon-es-products.csv";
const STORAGE_KEY = "secretshop-sitestripe-v1";
const elements = {
  file: document.querySelector("#csv-file"),
  reload: document.querySelector("#reload-source"),
  search: document.querySelector("#product-search"),
  filter: document.querySelector("#product-filter"),
  list: document.querySelector("#product-list"),
  currentTitle: document.querySelector("#current-title"),
  currentMeta: document.querySelector("#current-meta"),
  currentStatus: document.querySelector("#current-status"),
  amazonLink: document.querySelector("#amazon-link"),
  payload: document.querySelector("#sitestripe-code"),
  save: document.querySelector("#save-code"),
  skip: document.querySelector("#skip-product"),
  remove: document.querySelector("#remove-image"),
  preview: document.querySelector("#image-preview"),
  previewEmpty: document.querySelector("#preview-empty"),
  completed: document.querySelector("#completed-count"),
  total: document.querySelector("#total-count"),
  progress: document.querySelector("#progress-bar"),
  exportCsv: document.querySelector("#export-csv"),
  exportBackup: document.querySelector("#export-backup"),
  importBackup: document.querySelector("#import-backup"),
  backupFile: document.querySelector("#backup-file"),
  message: document.querySelector("#message")
};

let headers = [];
let products = [];
let selectedAsin = null;
let captures = loadCaptures();

function loadCaptures() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistCaptures() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(captures));
}

function message(text, type = "info") {
  elements.message.textContent = text;
  elements.message.dataset.type = type;
  elements.message.hidden = false;
}

function clearMessage() {
  elements.message.hidden = true;
  elements.message.textContent = "";
}

function activeProducts() {
  return products.filter((product) => {
    const active = String(product.active || "true").trim().toLowerCase();
    return !["false", "0", "no", "inactive", "inactivo"].includes(active);
  });
}

function productState(product) {
  const capture = captures[product.asin];
  if (capture?.imageUrl) return "completed";
  if (capture?.skipped) return "skipped";
  return "pending";
}

function filteredProducts() {
  const query = elements.search.value.trim().toLocaleLowerCase("es");
  const filter = elements.filter.value;
  return activeProducts().filter((product) => {
    if (filter !== "all" && productState(product) !== filter) return false;
    if (!query) return true;
    return [product.asin, product.title, product.brand]
      .join(" ")
      .toLocaleLowerCase("es")
      .includes(query);
  });
}

function updateProgress() {
  const active = activeProducts();
  const completed = active.filter((product) => productState(product) === "completed").length;
  elements.completed.textContent = completed;
  elements.total.textContent = active.length;
  elements.progress.max = Math.max(active.length, 1);
  elements.progress.value = completed;
  elements.exportCsv.disabled = !products.length || completed === 0;
}

function renderList() {
  const visible = filteredProducts();
  elements.list.replaceChildren(
    ...visible.map((product) => {
      const button = document.createElement("button");
      const state = productState(product);
      button.type = "button";
      button.className = "product-item";
      button.dataset.state = state;
      button.dataset.selected = String(product.asin === selectedAsin);
      button.innerHTML = `
        <span class="product-state" aria-hidden="true"></span>
        <span>
          <strong>${escapeHtml(product.title || "Producto sin título")}</strong>
          <small>${escapeHtml(product.brand || "Sin marca")} · ${product.asin}</small>
        </span>
      `;
      button.addEventListener("click", () => selectProduct(product.asin));
      return button;
    })
  );

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "No hay productos con este filtro.";
    elements.list.append(empty);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function currentProduct() {
  return products.find((product) => product.asin === selectedAsin) || null;
}

function selectProduct(asin) {
  selectedAsin = asin;
  elements.payload.value = "";
  clearMessage();
  renderCurrent();
  renderList();
}

function renderCurrent() {
  const product = currentProduct();
  const disabled = !product;
  elements.payload.disabled = disabled;
  elements.save.disabled = disabled;
  elements.skip.disabled = disabled;
  elements.remove.disabled = disabled || !captures[selectedAsin];

  if (!product) {
    elements.currentTitle.textContent = "Carga el catálogo para comenzar";
    elements.currentMeta.textContent = "";
    elements.currentStatus.textContent = "";
    elements.amazonLink.removeAttribute("href");
    elements.amazonLink.setAttribute("aria-disabled", "true");
    elements.preview.hidden = true;
    elements.previewEmpty.hidden = false;
    return;
  }

  const capture = captures[product.asin];
  const state = productState(product);
  elements.currentTitle.textContent = product.title || "Producto sin título";
  elements.currentMeta.textContent = `${product.brand || "Sin marca"} · ASIN ${product.asin} · fila ${product.__row}`;
  elements.currentStatus.textContent =
    state === "completed"
      ? "Imagen guardada"
      : state === "skipped"
        ? "Marcado para revisar después"
        : "Pendiente";
  elements.currentStatus.dataset.state = state;
  elements.amazonLink.href = `https://www.amazon.es/dp/${product.asin}`;
  elements.amazonLink.removeAttribute("aria-disabled");

  if (capture?.imageUrl) {
    elements.preview.src = capture.imageUrl;
    elements.preview.alt = `Vista previa de ${product.title}`;
    elements.preview.hidden = false;
    elements.previewEmpty.hidden = true;
  } else {
    elements.preview.removeAttribute("src");
    elements.preview.hidden = true;
    elements.previewEmpty.hidden = false;
  }
}

function selectNextPending() {
  const active = activeProducts();
  const currentIndex = active.findIndex((product) => product.asin === selectedAsin);
  const ordered = [...active.slice(currentIndex + 1), ...active.slice(0, currentIndex + 1)];
  const next = ordered.find((product) => productState(product) === "pending");
  if (next) selectProduct(next.asin);
  else {
    renderCurrent();
    message("No quedan productos pendientes en el catálogo.", "success");
  }
}

async function loadCsvText(text, sourceLabel) {
  const parsed = parseCsv(text);
  const normalized = parsed.rows.map((row) => ({
    ...row,
    asin: extractAsin(row.asin_or_url)
  }));
  const invalid = normalized.filter((row) => !row.asin);
  if (invalid.length) {
    throw new Error(`Hay ${invalid.length} filas sin un ASIN válido.`);
  }
  const unique = new Set(normalized.map((row) => row.asin));
  if (unique.size !== normalized.length) {
    throw new Error("El CSV contiene ASIN duplicados.");
  }

  headers = parsed.headers;
  products = normalized;
  const active = activeProducts();
  selectedAsin =
    active.find((product) => productState(product) === "pending")?.asin ||
    active[0]?.asin ||
    null;
  renderList();
  renderCurrent();
  updateProgress();
  message(
    `${active.length} productos cargados desde ${sourceLabel}. Los productos nuevos se añaden sin borrar el progreso anterior.`,
    "success"
  );
}

async function loadRepositoryCsv() {
  clearMessage();
  elements.reload.disabled = true;
  try {
    const response = await fetch(`${SOURCE_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await loadCsvText(await response.text(), "GitHub");
  } catch (error) {
    message(
      `No se pudo cargar el CSV automáticamente (${error.message}). Selecciónalo manualmente.`,
      "error"
    );
  } finally {
    elements.reload.disabled = false;
  }
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

elements.save.addEventListener("click", () => {
  const product = currentProduct();
  if (!product) return;
  try {
    const capture = parseSiteStripePayload(elements.payload.value, product.asin);
    captures[product.asin] = capture;
    persistCaptures();
    renderList();
    renderCurrent();
    updateProgress();
    selectNextPending();
    message(`Imagen validada para ${product.asin}.`, "success");
  } catch (error) {
    message(error.message, "error");
  }
});

elements.skip.addEventListener("click", () => {
  const product = currentProduct();
  if (!product) return;
  captures[product.asin] = {
    skipped: true,
    capturedAt: new Date().toISOString()
  };
  persistCaptures();
  renderList();
  updateProgress();
  selectNextPending();
});

elements.remove.addEventListener("click", () => {
  if (!selectedAsin) return;
  delete captures[selectedAsin];
  persistCaptures();
  renderList();
  renderCurrent();
  updateProgress();
  message("Se eliminó la captura guardada para este producto.", "info");
});

elements.exportCsv.addEventListener("click", () => {
  try {
    const result = applyCapturedImages(headers, products, captures);
    const date = new Date().toISOString().slice(0, 10);
    download(
      `amazon-es-products-sitestripe-${date}.csv`,
      serializeCsv(headers, result.rows),
      "text/csv;charset=utf-8"
    );
    message(
      `CSV generado con ${result.updated} imágenes de SiteStripe. Sustituye data/sources/amazon-es-products.csv y ejecuta el importador.`,
      "success"
    );
  } catch (error) {
    message(error.message, "error");
  }
});

elements.exportBackup.addEventListener("click", () => {
  const date = new Date().toISOString().slice(0, 10);
  download(
    `sitestripe-progreso-${date}.json`,
    `${JSON.stringify({ version: 1, captures }, null, 2)}\n`,
    "application/json"
  );
});

elements.importBackup.addEventListener("click", () => elements.backupFile.click());
elements.backupFile.addEventListener("change", async () => {
  const file = elements.backupFile.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const imported = parsed?.captures || parsed;
    if (!imported || typeof imported !== "object" || Array.isArray(imported)) {
      throw new Error("El archivo de progreso no es válido.");
    }
    captures = { ...captures, ...imported };
    persistCaptures();
    renderList();
    renderCurrent();
    updateProgress();
    message("Progreso importado correctamente.", "success");
  } catch (error) {
    message(error.message, "error");
  } finally {
    elements.backupFile.value = "";
  }
});

elements.file.addEventListener("change", async () => {
  const file = elements.file.files?.[0];
  if (!file) return;
  try {
    await loadCsvText(await file.text(), file.name);
  } catch (error) {
    message(error.message, "error");
  }
});
elements.reload.addEventListener("click", loadRepositoryCsv);
elements.search.addEventListener("input", renderList);
elements.filter.addEventListener("change", renderList);

loadRepositoryCsv();
