#!/usr/bin/env node
/**
 * Уведомляет поисковики об изменениях (IndexNow → Яндекс и др.).
 * Ключ: apps/web/public/{key}.txt (доступен на https://watermelon-messenger.ru/{key}.txt)
 *
 * Usage:
 *   node scripts/indexnow-ping.mjs
 *   node scripts/indexnow-ping.mjs --host watermelon-messenger.ru
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "wm8f3a2c1b9e4d7f6a";
const DEFAULT_HOST = "watermelon-messenger.ru";

function parseArgs() {
  const args = process.argv.slice(2);
  let host = process.env.WM_DOMAIN || DEFAULT_HOST;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--host" && args[i + 1]) host = args[++i];
  }
  return host.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function loadUrls(host) {
  const base = `https://${host}`;
  const sitemapPath = join(root, "apps/web/public/sitemap.xml");
  try {
    const xml = readFileSync(sitemapPath, "utf8");
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    if (urls.length > 0) return urls;
  } catch {
    /* fallback below */
  }
  return [
    `${base}/`,
    `${base}/legal/privacy`,
    `${base}/legal/personal-data-consent`,
    `${base}/legal/terms`,
    `${base}/faq`,
  ];
}

async function ping(endpoint, body) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  console.log(`${endpoint} → HTTP ${res.status}${text ? ` (${text.slice(0, 120)})` : ""}`);
  return res.ok || res.status === 202;
}

const host = parseArgs();
const urlList = loadUrls(host);
const body = {
  host,
  key: KEY,
  keyLocation: `https://${host}/${KEY}.txt`,
  urlList,
};

console.log(`IndexNow: ${urlList.length} URL → ${host}`);

const okYandex = await ping("https://yandex.com/indexnow", body);
const okGlobal = await ping("https://api.indexnow.org/indexnow", body);

if (!okYandex && !okGlobal) {
  process.exitCode = 1;
}
