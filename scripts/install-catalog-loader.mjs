import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const indexPath = resolve(process.cwd(), "index.html");
const scriptTag = '  <script type="module" src="./scripts/catalog-bootstrap.js"></script>';
const analyticsMarker = "  <!-- Cloudflare Web Analytics -->";

const original = await readFile(indexPath, "utf8");

if (original.includes("./scripts/catalog-bootstrap.js")) {
  console.log("El cargador Awin ya está enlazado en index.html.");
  process.exit(0);
}

let updated;
if (original.includes(analyticsMarker)) {
  updated = original.replace(
    analyticsMarker,
    `${scriptTag}\n\n${analyticsMarker}`
  );
} else if (original.includes("</body>")) {
  updated = original.replace("</body>", `${scriptTag}\n\n</body>`);
} else {
  throw new Error("No se encontró un punto seguro para insertar el cargador.");
}

await writeFile(indexPath, updated, "utf8");
console.log("Cargador Awin enlazado en index.html. Permanece desactivado por configuración.");
