import test from "node:test";
import assert from "node:assert/strict";
import { allowedDestination } from "../assets/js/redirect.js";

test("acepta únicamente los destinos afiliados previstos", () => {
  assert.equal(
    allowedDestination("https://www.awin1.com/pclick.php?p=1&a=2&m=3"),
    "https://www.awin1.com/pclick.php?p=1&a=2&m=3"
  );
  assert.equal(
    allowedDestination("https://s.click.aliexpress.com/e/_ejemplo"),
    "https://s.click.aliexpress.com/e/_ejemplo"
  );
});

test("rechaza protocolos, hosts, rutas y parámetros inseguros", () => {
  for (const value of [
    "http://www.awin1.com/pclick.php?p=1&a=2&m=3",
    "https://awin1.com.ejemplo.test/pclick.php?p=1&a=2&m=3",
    "https://www.awin1.com/otra-ruta?p=1&a=2&m=3",
    "https://www.awin1.com/pclick.php?p=1&a=2",
    "https://s.click.aliexpress.com.ejemplo.test/e/_ejemplo",
    "https://example.com/producto",
    "javascript:alert(1)",
    ""
  ]) {
    assert.equal(allowedDestination(value), null, value);
  }
});
