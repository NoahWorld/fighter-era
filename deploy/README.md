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

启动与检查：

```sh
cd /opt/fighter-era/deploy
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl --fail --show-error --silent http://127.0.0.1:8088/health/ready
docker compose logs --tail 100 api
```

使用 `config --quiet` 检查配置，不输出解析后的凭据。API 容器监听 4317，宿主机仅发布 `127.0.0.1:8088`；PostgreSQL 不发布宿主机端口。容器资源、健康检查和日志轮换由 `compose.yaml` 管理，数据库数据保存在独立卷中。

启动先执行事务迁移并核验已应用迁移的摘要；迁移失败时服务停止，不能跳过或改写旧迁移制造就绪状态。升级数据库结构须新增迁移文件。肉鸽版本新增迁移 `002_roguelike_saves.sql`，清空旧永久经验和续关并停用旧存活对局编号，但保留账号、库存与历史成绩。更新前先备份，再同步审查后的项目文件及公开试玩目录并执行 `docker compose up -d --build`；保留 `deploy/.env` 与 `backups/`。

浏览器试玩由独立 `web` 容器提供，目录为 `/opt/fighter-era/playtest`，只复制 `server.js`、`index.html`、`style.css`、`src/browser.js`、`src/engine.js`、`src/renderer.js`、`src/assets.js` 与六张图集，按原路径组织。静态服务仅允许公开资源；私有配置、后端源码和 Git 数据不可访问。默认公开端口 8080，可在私有配置中设置 `PLAYTEST_PORT`。云安全组需放行此 TCP 端口；已有 80 端口应用不变。启动前必须先创建并填充试玩目录，不能让空目录伪装健康。

浏览器试玩当前使用 HTTP 和本机存档，可用于朋友测试；真实微信登录和跨设备账号存档仍需要 AppSecret 与 HTTPS 接入。当前没有公网 HTTPS 网关。`/health/ready` 报告数据库 `ready`、微信 `pending_configuration`，以及支付和广告 `not_enabled`，只代表数据库服务可用。真实登录还需服务器 AppSecret、HTTPS 地址、微信 request 合法域名和客户端公开 `apiBase`。网关接入不得未经任务授权修改已有应用的配置。

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

真实微信登录、HTTPS 域名请求、跨设备续关、支付、广告和真机兼容尚未验证。后续版本重新执行检查，并更新实际结果；不能把当前数据库测试范围扩展成上述能力已开通。

后端接口与测试运行方法见 [后端说明](../backend/README.md)，客户端存档行为见 [项目说明](../README.md)。
