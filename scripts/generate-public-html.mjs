/**
 * После vite build создаёт HTML-оболочки с уникальными title/description для публичных URL.
 * Роботы видят meta и текстовый контент в статическом HTML, а не только после выполнения JS.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const distDir = path.join(root, "apps/web/dist");
const metaPath = path.join(root, "apps/web/public-page-meta.json");
const landingPath = path.join(root, "apps/web/seo-landing.ru.json");
const siteUrl = "https://watermelon-messenger.ru";
const ogImage = `${siteUrl}/icon-512.png`;

const routes = JSON.parse(fs.readFileSync(metaPath, "utf8"));
const landing = JSON.parse(fs.readFileSync(landingPath, "utf8"));
const templatePath = path.join(distDir, "index.html");

if (!fs.existsSync(templatePath)) {
  console.error("generate-public-html: dist/index.html not found — run vite build first");
  process.exit(1);
}

const template = fs.readFileSync(templatePath, "utf8");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function upsertMeta(html, attr, key, content) {
  const pattern = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="[^"]*"\\s*/>`, "i");
  const tag = `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;
  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }
  return html.replace("</head>", `    ${tag}\n  </head>`);
}

function removeMeta(html, attr, key) {
  const pattern = new RegExp(`\\s*<meta\\s+${attr}="${key}"\\s+content="[^"]*"\\s*/>`, "gi");
  return html.replace(pattern, "");
}

function upsertLink(html, rel, href) {
  const pattern = new RegExp(`<link\\s+rel="${rel}"\\s+href="[^"]*"\\s*/>`, "i");
  const tag = `<link rel="${rel}" href="${escapeHtml(href)}" />`;
  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }
  return html.replace("</head>", `    ${tag}\n  </head>`);
}

function upsertJsonLd(html, schemas) {
  let out = html.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, "");
  if (!schemas?.length) {
    return out;
  }
  const block = schemas
    .map((schema) => `    <script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n    </script>`)
    .join("\n");
  return out.replace("</head>", `${block}\n  </head>`);
}

function buildJsonLd(route, canonical) {
  const schemas = [];
  if (!route.jsonLd?.length) {
    return schemas;
  }

  if (route.jsonLd.includes("WebSite")) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: landing.headline,
      url: canonical,
      description: route.description,
      inLanguage: "ru-RU",
      publisher: {
        "@type": "Organization",
        name: landing.headline,
        url: siteUrl,
      },
    });
  }

  if (route.jsonLd.includes("SoftwareApplication")) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: landing.headline,
      url: canonical,
      applicationCategory: "CommunicationApplication",
      operatingSystem: "Web, iOS, Android",
      description: route.description,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "RUB",
      },
    });
  }

  return schemas;
}

function buildLandingBody() {
  const features = landing.features
    .map((item) => `      <li>${escapeHtml(item)}</li>`)
    .join("\n");
  const links = landing.links
    .map((item) => `      <li><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a></li>`)
    .join("\n");

  // Только для роботов без JS — в браузере с JS <noscript> не участвует в вёрстке и не скроллится.
  return `<noscript>
  <main class="wm-seo-landing" id="wm-seo-fallback">
    <h1>${escapeHtml(landing.headline)}</h1>
    <p><strong>${escapeHtml(landing.tagline)}</strong></p>
    <p>${escapeHtml(landing.intro)}</p>
    <h2>Возможности</h2>
    <ul>
${features}
    </ul>
    <h2>Разделы сайта</h2>
    <ul>
${links}
    </ul>
  </main>
</noscript>`;
}

function buildLoginBody() {
  return `<noscript>
  <main class="wm-seo-landing">
    <h1>${escapeHtml(landing.headline)} — вход</h1>
    <p>${escapeHtml(landing.tagline)}</p>
    <p>Войдите через Яндекс ID — единственный способ авторизации в ${escapeHtml(landing.headline)}.</p>
    <p><a href="/login">Перейти ко входу</a> · <a href="/">На главную</a> · <a href="/faq">FAQ</a></p>
  </main>
</noscript>`;
}

function injectSeoBody(html, seoBody) {
  let withoutBody = html.replace(/\s*<main class="wm-seo-landing"[\s\S]*?<\/main>/gi, "");
  withoutBody = withoutBody.replace(/\s*<noscript>[\s\S]*?<\/noscript>/gi, "");
  if (!seoBody) {
    return withoutBody;
  }

  const body =
    seoBody === "landing" ? buildLandingBody() : seoBody === "login" ? buildLoginBody() : "";
  if (!body) {
    return withoutBody;
  }

  return withoutBody.replace('<div id="root"></div>', `<div id="root"></div>\n    ${body}`);
}

function injectPageMeta(html, { title, description, canonical, robots, ogImageUrl, jsonLdSchemas, seoBody }) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  out = upsertMeta(out, "name", "description", description);
  out = upsertMeta(out, "property", "og:title", title);
  out = upsertMeta(out, "property", "og:description", description);
  out = upsertMeta(out, "property", "og:url", canonical);
  out = upsertMeta(out, "property", "og:image", ogImageUrl);
  out = upsertMeta(out, "property", "og:locale", "ru_RU");
  out = upsertLink(out, "canonical", canonical);

  out = removeMeta(out, "name", "robots");
  if (robots) {
    out = upsertMeta(out, "name", "robots", robots);
  }

  out = upsertJsonLd(out, jsonLdSchemas);
  out = injectSeoBody(out, seoBody);
  return out;
}

for (const route of routes) {
  const canonicalPath = route.canonicalPath ?? route.pathname;
  const canonical = `${siteUrl}${canonicalPath}`;
  const html = injectPageMeta(template, {
    title: route.title,
    description: route.description,
    canonical,
    robots: route.robots ?? "index, follow",
    ogImageUrl: ogImage,
    jsonLdSchemas: buildJsonLd(route, canonical),
    seoBody: route.seoBody,
  });
  const outPath = path.join(distDir, route.htmlFile);
  fs.writeFileSync(outPath, html);
  console.log(`generate-public-html: ${route.htmlFile} ← ${route.pathname}`);
}

console.log(`generate-public-html: ${routes.length} public HTML shells`);
