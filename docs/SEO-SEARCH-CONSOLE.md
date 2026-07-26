# SEO y Google Search Console — SecretShop

## Estado automatizado

- `robots.txt` publica el índice de sitemaps.
- `sitemap.xml` referencia el sitemap global y los sitemaps regionales publicados.
- Las fichas se generan con canonical absoluta, `WebPage` y `BreadcrumbList`; las de variante única con precio válido añaden `Product` y `AggregateOffer`, evitando agrupar variantes distintas como si fueran una sola oferta.
- La portada declara `Organization` y `WebSite`.
- `npm run quality` ejecuta también `npm run validate:seo`.
- `data/config/seo-state.json` conserva fechas `lastmod` fiables para páginas globales.

## Conexión con Google Search Console

1. Abre Google Search Console con la cuenta que administrará SecretShop.
2. Añade una **propiedad de dominio** con el valor exacto `getsecretshop.com`.
3. Copia el registro TXT de verificación proporcionado por Google.
4. En Cloudflare, entra en DNS de `getsecretshop.com` y crea un registro:
   - Tipo: `TXT`
   - Nombre: `@`
   - Contenido: el valor completo `google-site-verification=...`
   - TTL: automático
5. Mantén ese TXT incluso después de verificar.
6. En Search Console, pulsa **Verificar**.
7. En **Sitemaps**, envía `https://getsecretshop.com/sitemap.xml`.
8. Inspecciona inicialmente:
   - `https://getsecretshop.com/`
   - una ficha de producto representativa;
   - `https://getsecretshop.com/guias/compra-segura.html`.

No añadas el token de verificación al repositorio cuando utilices la propiedad de dominio: la verificación se conserva en DNS.
