#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { importAwinFeed } from "./lib/awin-catalog-core.mjs";
import { atomicWriteJson } from "./lib/awin-feed-utils.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publisherId = "2996453";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArguments(argv) {
  const options = {
    inputPath: null,
    merchantId: null,
    regionId: null,
    generatedAt: new Date().toISOString(),
    reportPath: null,
    dryRun: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--merchant") options.merchantId = String(argv[++index] || "").trim();
    else if (value === "--region") options.regionId = String(argv[++index] || "").trim().toLowerCase();
    else if (value === "--generated-at") options.generatedAt = new Date(argv[++index] || "").toISOString();
    else if (value === "--report") options.reportPath = resolve(argv[++index] || "");
    else if (value === "--dry-run") options.dryRun = true;
    else if (value === "--help" || value === "-h") options.help = true;
    else if (value.startsWith("--")) throw new Error(`Opción desconocida: ${value}`);
    else if (!options.inputPath) options.inputPath = resolve(value);
    else throw new Error(`Argumento inesperado: ${value}`);
  }
  return options;
}

function printHelp() {
  console.log(`Uso:
  node scripts/import-awin-region.mjs <feed.csv.gz> --merchant <id> --region <id> [opciones]

Opciones:
  --generated-at <ISO>  Fecha reproducible para el catálogo generado.
  --report <ruta>       Ruta del informe de importación regional.
  --dry-run             Valida todo sin modificar el catálogo regional.
  --help                Muestra esta ayuda.`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function repositoryPath(publicPath) {
  const value = String(publicPath || "");
  assert(value.startsWith("/") && !value.includes(".."), `Ruta pública insegura: ${value}`);
  const output = resolve(root, `.${value}`);
  assert(output === root || output.startsWith(`${root}${sep}`), `Ruta fuera del repositorio: ${value}`);
  return output;
}

function collectOffers(payload) {
  return (payload.families || []).flatMap((family) =>
    (family.variants || []).flatMap((variant) => variant.offers || [])
  );
}

function validateAwinUrl(value, advertiserId, offerId) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${offerId}: enlace Awin inválido`);
  }
  assert(url.protocol === "https:", `${offerId}: el enlace Awin no usa HTTPS`);
  assert(/(^|\.)awin1\.com$/i.test(url.hostname), `${offerId}: dominio Awin no permitido`);
  assert(["/pclick.php", "/cread.php"].includes(url.pathname), `${offerId}: ruta Awin no permitida`);
  assert((url.searchParams.get("a") || url.searchParams.get("awinaffid")) === publisherId, `${offerId}: publisher Awin incorrecto`);
  assert((url.searchParams.get("m") || url.searchParams.get("awinmid")) === String(advertiserId), `${offerId}: advertiser Awin incorrecto`);
  assert(Boolean(url.searchParams.get("p") || url.searchParams.get("ued")), `${offerId}: destino Awin ausente`);
  return url.href;
}

function landingHostAllowed(value, merchant) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (merchant.landingDomains || []).some((domain) => hostname === String(domain).toLowerCase());
  } catch {
    return false;
  }
}

async function pythonExecutable() {
  const candidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  for (const executable of candidates) {
    try {
      await execFileAsync(executable, ["--version"], { timeout: 10_000 });
      return executable;
    } catch {}
  }
  throw new Error("No se encontró Python 3 para construir las familias regionales");
}

export async function importRegionalAwinFeed(options) {
  assert(options.inputPath, "Falta la ruta del feed");
  assert(options.merchantId, "Falta --merchant <id>");
  assert(options.regionId, "Falta --region <id>");
  assert(Number.isFinite(Date.parse(options.generatedAt)), "--generated-at no es una fecha ISO válida");

  const [merchantsPayload, profilesPayload, taxonomyPayload, regionsPayload] = await Promise.all([
    readJson(resolve(root, "data/catalog/merchants.json")),
    readJson(resolve(root, "data/catalog/awin-import-profiles.json")),
    readJson(resolve(root, "data/catalog/category-taxonomy.json")),
    readJson(resolve(root, "data/config/regions.json"))
  ]);
  const merchant = merchantsPayload.merchants.find((entry) => entry.id === options.merchantId);
  const region = regionsPayload.regions.find((entry) => entry.id === options.regionId);
  assert(merchant?.status === "approved", `${options.merchantId}: merchant no aprobado`);
  assert(region, `${options.regionId}: región inexistente`);
  assert(region.catalogManifest && region.affiliateLinks, `${region.id}: faltan archivos regionales`);
  assert((merchant.countries || [merchant.country]).includes(region.countryCode), `${merchant.id}: ${region.countryCode} no está permitido`);
  const profile = { ...profilesPayload.default, ...(profilesPayload.merchants?.[merchant.id] || {}) };
  assert(String(profile.country || merchant.country).toUpperCase() === region.countryCode, `${merchant.id}: perfil de país incompatible con ${region.id}`);
  assert(String(profile.currency || merchant.currency).toUpperCase() === region.currency, `${merchant.id}: perfil de moneda incompatible con ${region.id}`);

  const manifestPath = repositoryPath(region.catalogManifest);
  const affiliateLinksPath = repositoryPath(region.affiliateLinks);
  const manifest = await readJson(manifestPath);
  const currentLinksPayload = await readJson(affiliateLinksPath);
  const sourceId = `awin-${merchant.id}`;
  const sourceRelativePath = `data/catalog/${region.id}/${sourceId}.json`;
  const sourcePublicPath = `/${sourceRelativePath}`;
  const sourcePath = resolve(root, sourceRelativePath);
  const stagingDirectory = await mkdtemp(join(tmpdir(), "secretshop-awin-region-"));

  try {
    await Promise.all([
      atomicWriteJson(resolve(stagingDirectory, "products.json"), { schemaVersion: 1, generatedAt: null, products: [] }),
      atomicWriteJson(resolve(stagingDirectory, "offers.json"), { schemaVersion: 1, generatedAt: null, offers: [] }),
      atomicWriteJson(resolve(stagingDirectory, "merchants.json"), merchantsPayload)
    ]);

    const imported = await importAwinFeed({
      inputPath: options.inputPath,
      merchantId: merchant.id,
      catalogDir: stagingDirectory,
      profilesPath: resolve(root, "data/catalog/awin-import-profiles.json"),
      taxonomyPath: resolve(root, "data/catalog/category-taxonomy.json"),
      generatedAt: options.generatedAt,
      reportPath: resolve(stagingDirectory, "import-report.json"),
      dryRun: false,
      pruneOrphans: true
    });

    const python = await pythonExecutable();
    await execFileAsync(python, [resolve(root, "scripts/build-product-families.py")], {
      cwd: root,
      env: { ...process.env, SECRETSHOP_CATALOG_DIR: stagingDirectory },
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024
    });
    const stagedFamilies = await readJson(resolve(stagingDirectory, "families.json"));
    const familiesPayload = {
      schemaVersion: 3,
      generatedAt: options.generatedAt,
      country: region.countryCode,
      currency: region.currency,
      families: stagedFamilies.families || []
    };
    const publicOffers = collectOffers(familiesPayload);
    assert(familiesPayload.families.length > 0, `${merchant.id}: no se generaron familias`);
    assert(publicOffers.length > 0, `${merchant.id}: no se generaron ofertas públicas`);
    for (const offer of publicOffers) {
      assert(offer.merchantId === merchant.id, `${offer.id}: merchant regional incorrecto`);
      assert(offer.country === region.countryCode, `${offer.id}: país regional incorrecto`);
      assert(offer.currency === region.currency, `${offer.id}: moneda regional incorrecta`);
    }

    const importedOffers = new Map(
      imported.offers.offers
        .filter((offer) => offer.merchantId === merchant.id)
        .map((offer) => [offer.id, offer])
    );
    const newLinks = {};
    for (const offer of publicOffers) {
      const canonical = importedOffers.get(offer.id);
      assert(canonical, `${offer.id}: falta la oferta importada`);
      assert(landingHostAllowed(canonical.landingUrl, merchant), `${offer.id}: dominio de destino no permitido`);
      newLinks[offer.id] = {
        url: validateAwinUrl(canonical.affiliateUrl, merchant.awinAdvertiserId, offer.id),
        merchantId: merchant.id,
        country: region.countryCode
      };
    }

    const otherFamilyIds = new Set();
    for (const source of manifest.sources || []) {
      if (source.id === sourceId || source.path === sourcePublicPath) continue;
      const payload = await readJson(repositoryPath(source.path));
      for (const family of payload.families || []) otherFamilyIds.add(family.id);
    }
    const collisions = familiesPayload.families.filter((family) => otherFamilyIds.has(family.id));
    assert(collisions.length === 0, `${region.id}: familias duplicadas con otra fuente: ${collisions.slice(0, 3).map((family) => family.id).join(", ")}`);

    const nextManifest = {
      ...manifest,
      sources: [
        ...(manifest.sources || []).filter((source) => source.id !== sourceId && source.path !== sourcePublicPath),
        {
          id: sourceId,
          path: sourcePublicPath,
          country: region.countryCode,
          currency: region.currency,
          merchantId: merchant.id,
          merchantName: merchant.name
        }
      ]
    };
    const retainedLinks = Object.fromEntries(
      Object.entries(currentLinksPayload.links || {}).filter(([, entry]) => entry.merchantId !== merchant.id)
    );
    const nextLinksPayload = {
      schemaVersion: 1,
      region: region.id,
      country: region.countryCode,
      generatedAt: options.generatedAt,
      links: Object.fromEntries(Object.entries({ ...retainedLinks, ...newLinks }).sort(([left], [right]) => left.localeCompare(right, "en")))
    };
    const report = {
      schemaVersion: 1,
      generatedAt: options.generatedAt,
      mode: options.dryRun ? "dry_run" : "full",
      merchantId: merchant.id,
      advertiserId: String(merchant.awinAdvertiserId),
      feedId: String(merchant.feedId),
      region: region.id,
      country: region.countryCode,
      currency: region.currency,
      regionStatus: region.status,
      sourcePath: sourcePublicPath,
      rawRows: imported.report.totals.feedRows,
      acceptedRows: imported.report.totals.acceptedRows,
      rejectedRows: imported.report.totals.skippedRows,
      rejectionReasons: imported.report.skipReasons,
      families: familiesPayload.families.length,
      variants: familiesPayload.families.reduce((total, family) => total + (family.variants || []).length, 0),
      offers: publicOffers.length,
      affiliateLinks: Object.keys(newLinks).length,
      safety: {
        exactCountry: true,
        exactCurrency: true,
        publisherId,
        landingDomainsVerified: true,
        regionStatusPreserved: true
      }
    };

    if (!options.dryRun) {
      await Promise.all([
        atomicWriteJson(sourcePath, familiesPayload),
        atomicWriteJson(manifestPath, nextManifest),
        atomicWriteJson(affiliateLinksPath, nextLinksPayload),
        atomicWriteJson(
          options.reportPath || resolve(root, `data/catalog/import-reports/${merchant.id}-${region.id}-last.json`),
          report
        )
      ]);
    }
    return report;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    printHelp();
    return null;
  }
  const report = await importRegionalAwinFeed(options);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(`[SecretShop] ${error.message}`);
    process.exitCode = 1;
  });
}
