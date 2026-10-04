# 战机时代后端

Node.js 22、Fastify 5 和 PostgreSQL 17。此目录独立于零依赖游戏客户端。真实登录只使用服务端向微信兑换的 `openid`，客户端不能指定账号。当前不获取头像、昵称；AppSecret 只放服务器配置，微信 `session_key` 不下发、不入库。自有登录令牌随机生成，数据库仅保存 SHA-256 摘要，有效期默认 30 天。

微信客户端的 `src/cloud-config.js` 默认 `apiBase` 为空，使用本机存档。HTTPS 网关与证书的部署、验证记录见 [部署说明](../deploy/README.md)；服务器 AppSecret 仍待配置，微信合法请求域名、真实登录及跨设备存档尚未验证。数据库就绪或 HTTPS 可达都不代表真实微信登录已可用。充值和广告只预留数据结构，尚未启用；广告/充值复活尚无已验证奖励资格或可调用接口。

## 本地运行

```sh
cd backend
npm ci
cp .env.example .env
# 在 .env 中配置独立 PostgreSQL 数据库；AppSecret 未准备时保留为空。
npm start
```

启动会在数据库事务中执行迁移，并检查已执行迁移的摘要。迁移失败就停止启动。已部署的迁移文件不得改写，后续变化新增迁移文件。`002_roguelike_saves.sql` 清空旧规则的账号经验及续关，并停用旧存活对局编号，保留身份、库存、最高分和历史通关；旧版请求不能重新导入永久成长。`003_run_free_charges.sql` 新增每个 run ID 的免费炸弹、支援剩余计数；旧行默认 1 仅用于迁移起点，首次合法保存后同 ID 不允许回涨。已应用迁移保持原文件与摘要。

```sh
npm run check
npm test
# 将 TEST_DATABASE_URL 配置为独立测试库的私有连接地址后再运行 npm test。
```

集成测试必须使用名称以 `_test` 结尾、可丢弃的专用数据库；测试会执行迁移并创建测试记录，末项重跑 002 会重置该库全部存活对局的经验、续关点与状态，不能使用生产库或其他测试共享的数据库。不提供 `TEST_DATABASE_URL` 时会明确跳过 PostgreSQL 测试。API 模拟、跳过的数据库测试和真实数据库执行结果必须分别记录。

武器与免费次数版本于 2026-10-04 在服务器专用测试库通过全部 46 项测试，其中 24 项使用真实 PostgreSQL，0 失败、0 跳过。覆盖四种武器契约、旧版续关规范化、同一对局免费次数不可回涨、切回旧编号不可补回，以及后续关卡续关换编号继承剩余次数；测试库已删除，生产库用户数仍为 0。生产已应用 001、002、003；微信真实登录、广告、支付与复活仍待配置和验证。

肉鸽版本于 2026-10-03 在服务器独立测试库通过 26 项测试（7 项单元、19 项真实 PostgreSQL，0 失败、0 跳过）。覆盖死亡清零、终局不可恢复、存活边界恢复和前向迁移保留身份、库存与历史成绩。测试库已清理，生产库没有测试用户；这不代表真实微信登录或支付验证通过。

可信代理配置于 2026-10-04 通过本地语法检查，以及本地、服务器 `node --test backend/test/api.test.js backend/test/proxy.test.js` 的 13 项 API / 代理测试（0 失败、0 跳过）。代理测试验证直接模式和非网关连接不能用伪造转发头绕过限流、网关后的不同客户端各自计数、前置伪造地址不改变客户端身份、转发链中的网关地址不会增加可信跳数、IPv6 和 IPv4 映射 IPv6 网关地址，以及无转发头的健康检查。另已实测公网 HTTPS 与网关请求日志，结果见部署说明；此次未重新运行 PostgreSQL 集成测试。

Docker 从仓库根目录构建：

```sh
docker build -f backend/Dockerfile -t fighter-era-api .
```

服务默认绑定 `127.0.0.1:4317`。生产容器内部通过 `HOST=0.0.0.0` 监听，宿主机仅发布 `127.0.0.1:8088`；数据库不发布宿主机端口。战机专属 HTTPS 网关仅发布 443，不占用既有 80。独立部署位于 `/opt/fighter-era`，绝不修改既有 `/opt/learning-workbench` 及其应用、数据库或配置。步骤与验证范围见 [部署说明](../deploy/README.md)。

`TRUST_PROXY_HOPS` 默认 `0`，只允许 `0` 或 `1`；直接模式忽略 `X-Forwarded-*`。设置为 `1` 时必须同时配置精确的 IPv4 / IPv6 `TRUST_PROXY_ADDRESS`，缺失或无效时启动失败，不接受主机名或 CIDR。Fastify 5.12.5 已禁用仅按跳数信任代理，因此实际信任函数同时验证立即连接者地址及 `hop === 0`；IPv4 映射 IPv6 与原 IPv4 地址按同一对端处理，不能把 `trustProxy` 设为 `true` 或省略对端验证。

生产固定 `TRUST_PROXY_HOPS=1`、`TRUST_PROXY_ADDRESS=172.31.247.2`。网关和 API 使用专属内部网络 `https-api`（`172.31.247.0/29`），网关固定地址为 `172.31.247.2`，API 网络别名为 `api-https`；网关以 `api-https:4317` 为上游，同时通过原项目网络访问网页服务。Caddy 重写不可信来源的转发头，后端仅使用其最后一项客户端地址进行日志记录和每 IP 限流。原项目网络的数据库连接与宿主机回环 API 映射继续独立管理；修改网关固定地址时必须同步后端可信地址并重新验证。

HTTPS 网关使用 `/api/*` 并剥离 `/api` 后转发，后端实际路由仍为 `/health/*` 与 `/v1/*`。例如公开 `/api/health/ready` 对应后端 `/health/ready`，未来微信公开配置可设为 `apiBase=https://resetshi.work/api`；目前仍保持空值。`/health/ready` 返回数据库 `ready`、微信 `pending_configuration` 时仅表示数据库就绪；AppSecret 未配置的真实登录必须继续返回 `503 WECHAT_NOT_CONFIGURED`。

## 接口

所有保护接口使用 `Authorization: Bearer <token>`，服务端从登录令牌确定用户；每个响应包含 `x-request-id`，错误正文也含 `requestId`，便于关联日志。请求正文上限 64 KiB，字段、类型和范围由 `src/schemas.js` 严格验证，不自动纠正错误类型或删除未知字段。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /health/live` | 服务存活 |
| `GET /health/ready` | 数据库和迁移就绪；另报告微信待配置、支付及广告未启用状态 |
| `POST /v1/auth/wechat` | `{code}` → `{token,account}` |
| `GET /v1/me` | 读取当前账号、存档、库存 |
| `POST /v1/me/import` | 新账号首次导入本地存档，不能覆盖已有云端记录 |
| `PUT /v1/me/save` | 按存档版本提交对局、关卡记录和续关点 |
| `POST /v1/inventory/consume` | 扣除一个额外炸弹或支援道具 |

账号结构为 `{user:{id},revision,profile:{version:2,totalXp},bestScore,highestClearedStage,checkpoint,inventory:{bomb,support},migrationAllowed}`。存档和导入成功返回 `{account,mutationId}`；道具消耗返回 `{inventory,mutationId}`。未配置 AppSecret 时登录返回 `503 WECHAT_NOT_CONFIGURED`，不建立测试账号或伪造成功。

存档提交示例（其中 UUID 需替换为请求与对局的真实编号）：

```js
{
  mutationId: "UUID", expectedRevision: 0,
  profile: {version: 2, totalXp: 0}, bestScore: 1000,
  highestClearedStage: 1, checkpoint: null,
  run: {id: "UUID", stage: 0, score: 1000, kills: 10, status: "defeated"},
  stageResults: [{stage: 1, score: 1000, kills: 10}]
}
```

`run.stage` 与续关点 `stage` 从 0 到 99；`stageResults.stage` 与 `highestClearedStage` 从 1 到 100。累计经验上限为 100,000,000，分数上限 1,000,000,000，击杀数上限 1,000,000，续关生命上限 10,000；接口拒绝负数、非整数、越界值和多余字段。这些接口边界不等于游戏设计的等级上限。

版本 2 续关点示例：

```js
{
  version: 2, phase: "stage", stage: 0,
  seed: 123, randomState: 123, entityId: 0, totalTime: 0,
  score: 0, kills: 0, runStartXp: 0, totalXp: 0,
  player: {hp: 5, maxHp: 5, weaponLevel: 1, weapon: "gun"},
  fireInterval: 0.16, damageBonus: 0,
  freeCharges: {bomb: 1, support: 1}
}
```

续关点复用共享引擎 `src/engine.js` 的 `validateCheckpoint()`，并另设 API 数值边界。`phase="stage"` 保存关卡起点，从头生成波次，不恢复敌机、敌弹、粒子和活动中的技能；`phase="upgrade"` 回到 BOSS 已击败后的升级选择。生命必须为正，最终关不能保存升级选择状态。经验、生命、分数和击杀数恢复到续关边界；关中拾取另即时保存 weapon 与 weaponLevel，不把关中经验、生命或分数写入边界。checkpoint.totalXp 不能超过当前档案经验，runStartXp 必须为零；本局使用过的免费炸弹与支援次数不会因过关或恢复补回。weapon 仅允许 gun/laser/homing/explosive；恰好包含旧三字段的 player 显式规范化为 gun，多余字段或未知武器拒绝。

失败和胜利必须提交零经验及空续关点，最终胜利还必须包含第 100 关通关记录。终结对局不能再更新；新出击从第 1 关开始，或仅恢复云端已有存活续关点，使用新的 `run.id`。新对局须从第 1 关或云端存活续关的对应关卡开始，后者继承已消耗免费次数；升级界面必须有已提交的通关证据或与已存边界相同。当前协议不能区分第 1 关换编号的零经验续关与真正新出击，因此这些校验不代表完整反作弊。恢复升级选择界面时已击败的 BOSS 不再次计通关。`stageResults` 的分数和击杀数为过关时的累计值，不能超出对应对局提交值。

初次导入结构为 `{mutationId,profile,bestScore,checkpoint}`，仅 `migrationAllowed=true` 时可用。导入、存档和道具请求必须持久保存请求编号和内容，网络结果未知时使用相同内容重试。相同编号的不同内容返回 `409 MUTATION_REUSED`。存档版本冲突返回 `409 SAVE_CONFLICT` 和 `error.currentRevision`；当前客户端保留队列、明确提示并停止自动同步，不自动合并或覆盖，尚无交互式冲突恢复界面。

云队列与上下文使用版本 2；旧队列先完整归档到 `fighter-era.cloud-outbox.legacy-v1`，旧规则游戏写入不再发送，账号归属与未确认道具扣除请求仍保留。归档失败须停止，不能静默丢弃。

微信客户端另有身份归属约束：prepare 登录前验证 `fighter-era.cloud-context`（META），登录后先发送已有 outbox。只有 META 为空、outbox 的 `accountId=null` 且服务端允许迁移时，才把从未绑定账号的本机记录首次导入。已绑定账号的本机镜像永不再次导入，包含同账号重登；不能将旧账号镜像导入切换后的新账号。成功 prepare 先同步保存 META 的账号绑定，入口才更新本机镜像；校验、发送或保存失败时停止入口，不覆盖原记录。

微信适配致命伤发生时就将零经验、空续关的终局同步入队，不等待弹射动画；每次经验、续关点与终局变化先同步保存 outbox，关卡边界、切后台或每 10 秒异步发送；终局先入队再允许下一局开始。未知结果仍使用原请求编号和正文，不能按新请求重复结算。已配置 `apiBase` 但登录失败时停止开局并显示错误；未配置才使用默认本机模式。浏览器试玩不接入账号后端。

数据库通过事务、行锁和唯一索引保证重复请求不重复导入、重复计通关或重复扣道具。每个对局每关最多记一次通关。服务验证关卡顺序、状态变化、存活对局的经验变化和数值上限；同一存活对局减少经验仅允许回到已保存的相同续关边界，结束对局必须归零，新出击允许重新从零成长；免费次数另按每个对局编号持久约束，同 ID、回切旧 ID 或已识别的后续关卡续关换 ID 均不能重新领取，第 1 关换编号的协议限制见上文。普通存档不能携带复活、奖励授权或库存字段；广告、充值与复活路径仍未启用。本阶段不是完整战斗服务器，不将这些检查称为完全防作弊。

## 充值与广告基础

额外库存独立于每局免费炸弹和支援；存档更新不能修改道具库存。已有库存、流水、支付订单和广告奖励记录表。内部 `grantInventory()` 根据已验证来源编号发放，并事务去重；没有对外发放接口。

当前没有启用付款、广告或回调发奖接口。后续接入时须使用符合小游戏账号能力的平台方案，服务端核验支付或奖励资格后才调用发放，不能根据客户端“付款成功”“已看完广告”直接发道具。实际支付资格、商品、价格、广告位和验证方式须在接入时确定。

数据库与服务日志、备份、部署命令由 [部署说明](../deploy/README.md) 维护。日志保留用户内部编号、请求编号、对局编号和存档版本，不记录授权头、登录凭证或密钥。
