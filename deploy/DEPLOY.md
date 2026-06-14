# Production deploy — Watermelon Messenger

Домен: **watermelon-messenger.ru**

## Релиз (единственный способ запустить CI/CD)

CI/CD **не** запускается на обычные коммиты. Только при push в `main` с сообщением:

```bash
git commit -m "ver 1.0.0"
git push origin main
```

Формат: `ver MAJOR.MINOR.PATCH` (semver, первая строка коммита).

### Что происходит автоматически

1. Unit-тесты + сборка web + smoke `/health`
2. Docker-образы → Docker Hub с тегом `:X.Y.Z`
3. Rsync конфигов + `.env` на сервер → deploy

Playwright/E2E **не** используются в релизе. `E2E_TEST_SECRET` на prod **не задаётся**.

## GitHub Secrets

| Secret | Назначение |
|--------|------------|
| `DOCKERHUB_TOKEN` | Access token Docker Hub (аккаунт **plwatermelon**) |
| `PROD_ENV_FILE` | **Полное содержимое** `.env` (многострочный) |
| `DEPLOY_SSH_HOST` | IP/хост сервера |
| `DEPLOY_SSH_USER` | SSH-пользователь |
| `DEPLOY_SSH_KEY` | Приватный SSH-ключ |
| `DEPLOY_PATH` | Путь на сервере, напр. `/opt/watermelon-messenger` |

### Как добавить PROD_ENV_FILE

```bash
# локально заполните .env.prod по шаблону
cp deploy/.env.example .env
nano .env

# скопируйте содержимое в GitHub → Settings → Secrets → PROD_ENV_FILE
# (вставьте весь файл целиком)
```

При каждом релизе секрет перезаписывает `.env` на сервере.

## Первичная настройка сервера

```bash
ssh ubuntu@195.209.218.182   # твой IP

# Docker + compose v2 (обязательно до деплоя!)
# get.docker.com падает на Ubuntu 20.04 — см. scripts/install-docker.sh
bash scripts/install-docker.sh

newgrp docker
docker --version && docker compose version

sudo mkdir -p /opt/watermelon-messenger/{deploy,scripts}
sudo chown -R $USER:$USER /opt/watermelon-messenger
```

`DEPLOY_SSH_USER` (например `ubuntu`) должен **владеть** каталогом — иначе rsync из CI получит `Permission denied`.

### TLS (Let's Encrypt) — автоматически при deploy

**DNS:**
| A `@` | IP сервера |
| A `www` | IP сервера |

**В `.env` / `PROD_ENV_FILE`:**
```env
CERTBOT_EMAIL=you@example.com
```

При каждом `ver X.Y.Z` deploy **сам**:
1. Поднимает stack
2. Если cert нет → Let's Encrypt (apex + www) → HTTPS
3. Если cert есть → сразу HTTPS

Ручной `./scripts/certbot-init.sh` не нужен.

## Yandex OAuth

| Поле | Значение |
|------|----------|
| Redirect URI | `https://watermelon-messenger.ru/api/auth/yandex/callback` |
| Suggest Hostname | `watermelon-messenger.ru` |

## Ручной депл конфигов (без CI)

```bash
DEPLOY_HOST=your.server DEPLOY_USER=root DEPLOY_PATH=/opt/watermelon-messenger \
  ENV_FILE=.env ./scripts/sync-prod-config.sh

ssh user@host "cd /opt/watermelon-messenger && WM_VERSION=1.0.0 ./scripts/deploy-server.sh"
```

## Структура на сервере

```
/opt/watermelon-messenger/
├── .env                   ← секреты (из PROD_ENV_FILE)
├── deploy/
│   ├── docker-compose.yml
│   ├── nginx.prod.conf
│   └── nginx.bootstrap.conf
└── scripts/
    ├── deploy-server.sh
    └── certbot-init.sh
```

## Rollback

```bash
WM_VERSION=1.0.0 ./scripts/deploy-server.sh   # предыдущая версия
```

## Мониторинг

- `GET https://watermelon-messenger.ru/api/health`
- Cron бэкап: `./scripts/backup-postgres.sh`
