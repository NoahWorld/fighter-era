# 战机时代独立部署与备份

后端使用 Node.js 22、Fastify 5 和 PostgreSQL 17，服务目录为 `/opt/fighter-era`。Compose 项目名固定为 `fighter-era`，配置位于 `/opt/fighter-era/deploy`；数据库、角色、凭据和数据卷独立管理。

**绝不修改 `/opt/learning-workbench` 或其应用、数据库、配置与运行服务。** 部署、更新、备份和恢复操作只针对战机时代自己的目录与 Compose 项目。不要执行针对整台服务器的清理、停止容器或删除数据卷操作。

## 配置与启动

服务器需要 Docker 与 Docker Compose。将经过审查的项目文件放入 `/opt/fighter-era`，保留私有环境配置与备份目录；构建上下文为仓库根目录，以便后端复用客户端续关验证器。

初次部署复制配置模板：

```sh
cd /opt/fighter-era
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

在 `deploy/.env` 中分别填写独立生成的数据库管理凭据与应用凭据；初始化脚本要求应用数据库凭据仅由十六进制字符组成。应用数据库角色 `fighter_app` 不是超级用户。小游戏 AppSecret 尚未准备时保持空，正式接入后只存服务器，不能进入公开仓库、客户端或日志。模板占位值不能直接用于正式部署；已有私有配置不能被更新覆盖。

尚未启用 HTTPS 的初次启动与检查如下；已启用 HTTPS 的服务器更新须使用后文两个 Compose 配置文件：

```sh
cd /opt/fighter-era/deploy
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl --fail --show-error --silent http://127.0.0.1:8088/health/ready
docker compose logs --tail 100 api
```

使用 `config --quiet` 检查配置，不输出解析后的凭据。API 容器监听 4317，宿主机仅发布 `127.0.0.1:8088`；PostgreSQL 不发布宿主机端口。容器资源、健康检查和日志轮换由 `compose.yaml` 管理，数据库数据保存在独立卷中。

启动先执行事务迁移并核验已应用迁移的摘要；迁移失败时服务停止，不能跳过或改写旧迁移制造就绪状态。升级数据库结构须新增迁移文件。肉鸽版本新增迁移 `002_roguelike_saves.sql`，清空旧永久经验和续关并停用旧存活对局编号，但保留账号、库存与历史成绩。更新前先备份，再同步审查后的项目文件及公开试玩目录；未启用 HTTPS 时使用基础 Compose 配置，已启用时按后文双配置命令更新。始终保留 `deploy/.env` 与 `backups/`。

浏览器网站由独立 `web` 容器提供，目录为 `/opt/fighter-era/playtest`，只复制 `server.js`、`index.html`、`game.html`、`style.css`、`src/browser.js`、`src/engine.js`、`src/renderer.js`、`src/assets.js` 与六张图集，按原路径组织。`/` 为字数统计工具，`/game` 和 `/game/` 显示游戏；游戏 HTML 以根目录 base 解析素材。静态服务仅允许公开资源；私有配置、后端源码和 Git 数据不可访问。默认公开端口 8080，可在私有配置中设置 `PLAYTEST_PORT`。云安全组需放行此 TCP 端口；已有 80 端口应用不变。启动前必须先创建并填充网站目录，不能让空目录伪装健康。只更新首页和静态路由时，备份当前公开文件后同步 `server.js`、`index.html`、`game.html`，使用双配置命令 `docker compose -f compose.yaml -f compose.https.yaml restart web`，无需重建 API、数据库或网关；随后检查首页、两个游戏路由及资源。

浏览器试玩使用本机存档，可用于朋友测试；真实微信登录和跨设备账号存档仍需要 AppSecret、微信 request 合法域名和客户端公开 `apiBase`。`/health/ready` 报告数据库 `ready`、微信 `pending_configuration`，以及支付和广告 `not_enabled`，只代表数据库服务可用。

## 域名与 HTTPS

域名 `resetshi.work` 与 `www.resetshi.work` 的 A 记录均指向 `47.116.38.160`，TTL 为 600 秒。HTTPS 网关是战机时代独立的 Caddy 容器，配置为 `Caddyfile` 和显式启用的 `compose.https.yaml`，只发布 TCP 443。首页工具地址为 `https://resetshi.work/`，游戏地址为 `https://resetshi.work/game`；`www` 提供相同路径和内容，公网 API 地址为 `https://resetshi.work/api`。`handle_path /api/*` 剥离 `/api` 后代理到 `api-https:4317`，其它路径代理到 `web:4173`，因此就绪地址为 `/api/health/ready`。

在私有 `deploy/.env` 配置 `FIGHTER_DOMAIN=resetshi.work` 和 `CADDY_IMAGE`。服务器使用经验证的 Caddy 2.11.6 镜像并固定镜像摘要；模板默认使用官方 `caddy:2-alpine`。启用前确认 DNS 已生效、443 空闲且云防火墙允许 TCP 443。检查 Docker 网络与云内网地址没有和专属 `172.31.247.0/29` 网络冲突。

网关同时接入默认网络与内部 `https-api` 网络，后者固定网关地址为 `172.31.247.2`；API 保留默认网络用于数据库，并在专属网络使用别名 `api-https`。HTTPS 覆盖配置设置 `TRUST_PROXY_HOPS=1` 与 `TRUST_PROXY_ADDRESS=172.31.247.2`，后端只信任此直接对端传来的单跳客户端地址，用于访问日志和每 IP 限流；非网关连接与额外前置地址不能伪造身份。不能仅凭跳数或任意转发头信任请求。

证书通过 Let's Encrypt 的 TLS-ALPN-01 在 443 上验证并自动续期。关闭 HTTP challenge 和自动 HTTP 跳转，网关不监听宿主机 80，既有应用继续使用原来的 80 端口；普通 `http://resetshi.work/` 不会自动跳转到游戏 HTTPS。证书和 ACME 账户仅存独立持久卷 `fighter-era_fighter-era-tls-data`，配置状态位于独立 `fighter-era_fighter-era-tls-config` 卷，不进入公开仓库。不要删除这些卷，否则会丢失证书与续期状态。

首次启用或后续更新使用两个配置文件，不能仅用基础配置重建 API 丢失可信代理设置。先备份，再更新。首次启用、网关尚未运行时，可用 `docker compose -f compose.yaml -f compose.https.yaml run --rm --no-deps gateway caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` 验证配置，然后启动 API 与网关。后续更新在已有网关内验证，避免临时容器争用固定地址：

```sh
cd /opt/fighter-era/deploy
docker compose -f compose.yaml -f compose.https.yaml config --quiet
docker compose -f compose.yaml -f compose.https.yaml exec -T gateway caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -f compose.yaml -f compose.https.yaml up -d --build --no-deps api gateway
docker compose -f compose.yaml -f compose.https.yaml ps
docker compose -f compose.yaml -f compose.https.yaml logs --tail 100 gateway
curl --fail --show-error --silent https://resetshi.work/api/health/ready
```

仅启动或重建战机的 API 与 gateway，保留正在运行的 web、db 与既有应用。Caddy 管理接口关闭，修改配置后重新创建或重启此网关。健康检查 `/healthz` 只在网关容器的 `127.0.0.1:2015` 监听；它表示网关已运行，证书和上游仍须另外通过公网 HTTPS 验证。HTTPS 使用标准端口，无需在游戏链接中加 `:8080`；原 HTTP 8080 试玩入口继续保留。

微信客户端 `apiBase` 当前仍为空。准备 AppSecret 后，可设置 `https://resetshi.work/api`，在微信平台登记合法请求域名并完成真实登录和真机测试。仅部署 HTTPS 不会自动启用微信登录、广告或支付。浏览器从 HTTP 8080 切到 HTTPS 属于不同来源，原地址的本机存档不会自动迁移。

## 备份

手动备份：

```sh
/bin/sh /opt/fighter-era/deploy/backup.sh
```

脚本使用 `pg_dump --format=custom`，在 `/opt/fighter-era/backups` 写入 UTC 时间命名的文件。先写 `.partial`，成功且非空才改为正式 `.dump`；失败时清理不完整文件并退出。文件权限受 `umask 077` 保护，脚本仅删除该目录下按 `-mtime +7` 选中的旧备份。`.env`、备份和日志均不能提交 Git。

安装每日计时器：

```sh
install -m 644 /opt/fighter-era/deploy/fighter-era-backup.service /etc/systemd/system/fighter-era-backup.service
install -m 644 /opt/fighter-era/deploy/fighter-era-backup.timer /etc/systemd/system/fighter-era-backup.timer
systemctl daemon-reload
systemctl enable --now fighter-era-backup.timer
systemctl start fighter-era-backup.service
systemctl status fighter-era-backup.timer
journalctl -u fighter-era-backup.service --no-pager -n 50
```

计时器每日按服务器时区 03:20 触发，随机延迟最多 5 分钟；停机错过的任务恢复后补执行。手动执行和计时器日志中的失败都必须处理，不能仅凭文件存在认为备份成功。当前只配置服务器本地备份，异机备份与异机容灾未配置。

## 独立恢复演练

将所选备份恢复到新建的独立数据库，先验证可读取及关键表，再制定生产恢复方案。以下目标仅用于演练，不覆盖生产数据库；目标名称已存在时 `createdb` 会报错，应查明原因后再处理。

```sh
set -eu
cd /opt/fighter-era/deploy
FIGHTER_ERA_DUMP='/opt/fighter-era/backups/<所选备份文件>.dump'
test -s "$FIGHTER_ERA_DUMP"
docker compose exec -T db pg_restore --list < "$FIGHTER_ERA_DUMP"
docker compose exec -T db createdb -U postgres -O fighter_app fighter_era_restore_test
docker compose exec -T db pg_restore -U postgres --no-owner --role=fighter_app --exit-on-error --dbname=fighter_era_restore_test < "$FIGHTER_ERA_DUMP"
docker compose exec -T db psql -U postgres -d fighter_era_restore_test -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS users FROM users; SELECT count(*) AS saves FROM player_saves;'
```

实际恢复生产库前须确定目标、停写时段、备份和回退方案。恢复演练成功不代表异机恢复或生产事故恢复已验证，不能把测试库操作直接改成生产库覆盖执行。

## 当前验证范围

首页与游戏路由于 2026-10-04 完成以下检查：

- `/` 改为单文件字数统计，`/game` 与 `/game/` 提供原游戏；实际浏览器验证中文、表情、空白、换行与清空操作，游戏图集正常显示，控制台无警告或错误。
- 主域名首页、两个游戏路由、样式、素材加载代码、玩家图集与 `/api/health/ready` 均通过严格证书校验返回 200；`www` 首页与 `/game` 返回 200，私有 `deploy/.env` 返回 404。三个公开更新文件的 SHA-256 与本地一致。
- 本地语法检查、2 项静态路由/访问限制测试与 7 项图集/微信包测试通过。首页和静态路由改动未重新执行客户端全量或后端测试。
- 更新前将公开目录备份到 `/opt/fighter-era/site-route-deploy-audit/20261004-home-game/playtest-before.tgz`，只重启 `web`；API、数据库、网关保持运行，API 仍报告微信待配置、广告与支付未启用。既有 `/opt/learning-workbench` 四个关键文件 SHA-256 与基线一致，原应用容器保持运行。

域名与 HTTPS 于 2026-10-04 完成以下检查：

- 阿里云 A 记录 `@` 与 `www` 均为 `47.116.38.160`，TTL 600；Google 与 Cloudflare 公共解析返回相同结果。
- 主域名和 `www` HTTPS 首页均返回 200，客户端严格验证证书通过。Let's Encrypt 已签发证书，主域名证书有效期至 2027-01-02 05:49:16 UTC；自动续期已配置，后续实际续期仍待观察。
- 实际浏览器通过 `https://resetshi.work/` 打开机库、出击并进入战斗，检查时控制台无警告或错误。12 项公开资源通过 HTTPS 返回 200 且与本地发布内容一致，5 项私有路径返回 404。
- 公网 `/api/health/ready` 返回 200、数据库 `ready`、微信 `pending_configuration`；未配置登录返回 `503 WECHAT_NOT_CONFIGURED`，无身份读取账号返回 401。伪造转发头的公网探针与对应请求日志确认后端识别真实客户端地址。
- 本地语法检查与本地、服务器 13 项 API / 代理测试均通过，0 失败、0 跳过；已运行网关的配置验证通过，独立 `gateway`、`api`、`web`、`db` 健康。此次未重复客户端全量测试、PostgreSQL 集成测试或备份恢复演练。
- 部署前完成独立数据库备份 `fighter-era-20261004T064319Z.dump`。既有 `/opt/learning-workbench` 四个关键文件 SHA-256 与基线一致，原容器身份与 HTTP 200 保持正常；私有 `deploy/.env` 权限仍为 600。

肉鸽版本于 2026-10-03 完成以下检查：

- `web`、`api`、`db` 容器健康；数据库已应用 `001_initial.sql` 与 `002_roguelike_saves.sql`。API 就绪 HTTP 200，微信仍为 `pending_configuration`，支付和广告仍为 `not_enabled`。
- 客户端 143 项测试与后端 26 项测试全部通过，0 失败、0 跳过；后端包含 19 项真实 PostgreSQL 集成测试。独立测试库已清理，生产用户数为 0。
- 服务器内部逐一读取首页、样式、四个 JS 文件和六张图集，12 项均 HTTP 200；私有环境、后端源码、Git 配置、源码版本记录和备份路径返回 404。
- 更新前后分别完成备份，文件为 `fighter-era-20261003T121311Z.dump` 与 `fighter-era-20261003T121758Z.dump`。此次未重新执行备份恢复演练。
- 既有应用四个关键文件 SHA-256 与更新前基线一致，原应用 HTTP 200；私有 `deploy/.env` 权限仍为 600。
- 已在对应阿里云轻量应用服务器防火墙添加 TCP `8080`、来源 `0.0.0.0/0`，备注「战机时代浏览器试玩」；原有 22、80、443、ICMP 规则未改动。[公网试玩入口](http://47.116.38.160:8080/) 已实测打开并出击；12 项资源 HTTP 200 且内容与本地发布一致，私有路径 HTTP 404。浏览器试玩仍为本机存档。

此前部署版本于 2026-10-03 完成以下检查（本次肉鸽版本另行记录）：

- API 在服务器 `127.0.0.1:8088` 就绪检查返回 HTTP 200；AppSecret 未配置时登录返回 `503 WECHAT_NOT_CONFIGURED`，未授权读取账号返回 401。
- 独立测试库通过 23 项后端测试：7 项单元测试、16 项 PostgreSQL 集成测试，0 跳过。
- 每日 03:20 备份计时器已启用；首次备份为 24,530 字节，恢复到独立数据库成功并核对 13 张表。测试和恢复数据库已清理，生产库没有保留测试用户。
- 既有 `/opt/learning-workbench` 四个关键文件的 SHA-256 与部署前基线一致；原应用跟随重定向后返回 HTTP 200。

真实微信登录、微信真机 HTTPS 请求、跨设备续关、支付、广告和真机兼容尚未验证。后续版本重新执行检查，并更新实际结果；不能把当前数据库测试范围扩展成上述能力已开通。

后端接口与测试运行方法见 [后端说明](../backend/README.md)，客户端存档行为见 [项目说明](../README.md)。
