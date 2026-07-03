import publicPages from "../../public-page-meta.json";

export type PageMeta = {
  title: string;
  description: string;
  robots?: string;
  canonical?: string;
};

const SITE_URL = "https://watermelon-messenger.ru";

export const HOME_PAGE_META: PageMeta = {
  title: "Watermelon Messenger — безопасный мессенджер с чатами, медиа и голосовыми",
  description:
    "Watermelon Messenger — self-hosted мессенджер: личные и групповые чаты, медиа, голосовые сообщения и push-уведомления. Вход через Яндекс ID. Клиенты для iOS, Android и web.",
  canonical: `${SITE_URL}/`,
  robots: "index, follow",
};

export const DEFAULT_PAGE_META: PageMeta = {
  ...HOME_PAGE_META,
};

const NOINDEX = "noindex, nofollow";

const PUBLIC_PAGE_BY_PATH = new Map(
  publicPages
    .filter((page) => page.pathname !== "/")
    .map((page) => {
      const canonicalPath = "canonicalPath" in page && page.canonicalPath ? page.canonicalPath : page.pathname;
      return [
        page.pathname,
        {
          title: page.title,
          description: page.description,
          canonical: `${SITE_URL}${canonicalPath}`,
          ...("robots" in page && page.robots ? { robots: page.robots } : {}),
        } satisfies PageMeta,
      ] as const;
    }),
);

/** Публичные страницы с уникальными title/description для поисковиков. */
export function getPageMeta(pathname: string): PageMeta {
  const publicMeta = PUBLIC_PAGE_BY_PATH.get(pathname);
  if (publicMeta) {
    return publicMeta;
  }

  // Корень: в статическом HTML — главная для поиска; в SPA с авторизацией — закрытый интерфейс чатов.
  if (pathname === "/") {
    return HOME_PAGE_META;
  }

  // Приватные и служебные маршруты — не индексируем.
  if (
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/beta/") ||
    pathname.startsWith("/chat/") ||
    pathname.startsWith("/profile") ||
    pathname.startsWith("/settings") ||
    pathname === "/admin" ||
    pathname === "/icon"
  ) {
    return { ...HOME_PAGE_META, robots: NOINDEX };
  }

  if (pathname !== "/" && pathname !== "") {
    return {
      title: "Страница не найдена — Watermelon Messenger",
      description: "Запрошенная страница Watermelon Messenger не найдена.",
      robots: NOINDEX,
    };
  }

  return HOME_PAGE_META;
}

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function removeMeta(attr: "name" | "property", key: string) {
  document.head.querySelector(`meta[${attr}="${key}"]`)?.remove();
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function removeLink(rel: string) {
  document.head.querySelector(`link[rel="${rel}"]`)?.remove();
}

export function applyPageMeta(meta: PageMeta) {
  document.title = meta.title;
  upsertMeta("name", "description", meta.description);
  upsertMeta("property", "og:title", meta.title);
  upsertMeta("property", "og:description", meta.description);

  if (meta.robots) {
    upsertMeta("name", "robots", meta.robots);
  } else {
    removeMeta("name", "robots");
  }

  if (meta.canonical) {
    upsertMeta("property", "og:url", meta.canonical);
    upsertLink("canonical", meta.canonical);
  } else {
    removeMeta("property", "og:url");
    removeLink("canonical");
  }
}
