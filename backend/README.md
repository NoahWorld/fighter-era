# 战机时代后端

Node.js 22、Fastify 5 和 PostgreSQL 17。此目录独立于零依赖游戏客户端。真实登录只使用服务端向微信兑换的 `openid`，客户端不能指定账号。当前不获取头像、昵称；AppSecret 只放服务器配置，微信 `session_key` 不下发、不入库。自有登录令牌随机生成，数据库仅保存 SHA-256 摘要，有效期默认 30 天。

微信客户端的 `src/cloud-config.js` 默认 `apiBase` 为空，使用本机存档。服务器尚未配置 AppSecret 与 HTTPS 网关；数据库就绪不代表真实微信登录已可用。充值和广告只预留数据结构，尚未启用。

## 本地运行

```sh
cd backend
npm ci
cp .env.example .env
# 在 .env 中配置独立 PostgreSQL 数据库；AppSecret 未准备时保留为空。
npm start
```

启动会在数据库事务中执行迁移，并检查已执行迁移的摘要。迁移失败就停止启动。已部署的迁移文件不得改写，后续变化新增迁移文件。

```sh
npm run check
npm test
# 将 TEST_DATABASE_URL 配置为独立测试库的私有连接地址后再运行 npm test。
```

集成测试必须使用名称以 `_test` 结尾的独立数据库；测试会执行迁移并创建测试记录，生产数据库不能用于这些测试。不提供 `TEST_DATABASE_URL` 时会明确跳过 PostgreSQL 测试。API 模拟、跳过的数据库测试和真实数据库执行结果必须分别记录。

当前已在服务器独立测试库通过 23 项测试（7 项单元、16 项 PostgreSQL，0 跳过）。后续改动应重新执行，以实际报告为准；这不代表真实微信登录或支付验证通过。

Docker 从仓库根目录构建：

```sh
docker build -f backend/Dockerfile -t fighter-era-api .
```

服务默认绑定 `127.0.0.1:4317`。生产容器内部通过 `HOST=0.0.0.0` 监听，宿主机仅发布 `127.0.0.1:8088`，后续由 HTTPS 网关接入；数据库不发布宿主机端口。独立部署位于 `/opt/fighter-era`，绝不修改既有 `/opt/learning-workbench` 及其应用、数据库或配置。步骤与验证范围见 [部署说明](../deploy/README.md)。

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

账号结构为 `{user:{id},revision,profile:{version:1,totalXp},bestScore,highestClearedStage,checkpoint,inventory:{bomb,support},migrationAllowed}`。存档和导入成功返回 `{account,mutationId}`；道具消耗返回 `{inventory,mutationId}`。未配置 AppSecret 时登录返回 `503 WECHAT_NOT_CONFIGURED`，不建立测试账号或伪造成功。

存档提交示例（其中 UUID 需替换为请求与对局的真实编号）：

```js
{
  mutationId: "UUID", expectedRevision: 0,
  profile: {version: 1, totalXp: 100}, bestScore: 1000,
  highestClearedStage: 1, checkpoint: null,
  run: {id: "UUID", stage: 0, score: 1000, kills: 10, status: "defeated"},
  stageResults: [{stage: 1, score: 1000, kills: 10}]
}
```

`run.stage` 与续关点 `stage` 从 0 到 99；`stageResults.stage` 与 `highestClearedStage` 从 1 到 100。累计经验上限为 100,000,000，分数上限 1,000,000,000，击杀数上限 1,000,000，续关生命上限 10,000；接口拒绝负数、非整数、越界值和多余字段。这些接口边界不等于游戏设计的等级上限。

版本 1 续关点示例：

```js
{
  version: 1, phase: "stage", stage: 0,
  seed: 123, randomState: 123, entityId: 0, totalTime: 0,
  score: 0, kills: 0, runStartXp: 0,
  player: {hp: 5, maxHp: 5, weaponLevel: 1},
  fireInterval: 0.16, damageBonus: 0,
  freeCharges: {bomb: 1, support: 1}
}
```

续关点复用共享引擎 `src/engine.js` 的 `validateCheckpoint()`，并另设 API 数值边界。`phase="stage"` 保存关卡起点，从头生成波次，不恢复敌机、敌弹、粒子和活动中的技能；`phase="upgrade"` 回到 BOSS 已击败后的升级选择。生命必须为正，最终关不能保存升级选择状态。当前永久经验取账号档案，关卡起点生命、火力、分数和击杀数取续关点；同关使用过的免费炸弹与支援次数不会因恢复补回。

失败可以保留续关点，最终胜利必须包含第 100 关通关记录并清空续关点。终结对局不能再更新；重新挑战或继续失败关卡使用新的 `run.id`。新对局可从第 1 关或合法续关点开始，恢复升级选择界面时已击败的 BOSS 不再次计通关。`stageResults` 的分数和击杀数为过关时的累计值，不能超出对应对局提交值。

初次导入结构为 `{mutationId,profile,bestScore,checkpoint}`，仅 `migrationAllowed=true` 时可用。导入、存档和道具请求必须持久保存请求编号和内容，网络结果未知时使用相同内容重试。相同编号的不同内容返回 `409 MUTATION_REUSED`。存档版本冲突返回 `409 SAVE_CONFLICT` 和 `error.currentRevision`；当前客户端保留队列、明确提示并停止自动同步，不自动合并或覆盖，尚无交互式冲突恢复界面。

微信客户端另有身份归属约束：prepare 登录前验证 `fighter-era.cloud-context`（META），登录后先发送已有 outbox。只有 META 为空、outbox 的 `accountId=null` 且服务端允许迁移时，才把从未绑定账号的本机记录首次导入。已绑定账号的本机镜像永不再次导入，包含同账号重登；不能将旧账号镜像导入切换后的新账号。成功 prepare 先同步保存 META 的账号绑定，入口才更新本机镜像；校验、发送或保存失败时停止入口，不覆盖原记录。

微信适配每次经验、续关点与终局变化先同步保存 outbox，关卡边界、切后台或每 10 秒异步发送；终局先入队再允许下一局开始。未知结果仍使用原请求编号和正文，不能按新请求重复结算。已配置 `apiBase` 但登录失败时停止开局并显示错误；未配置才使用默认本机模式。浏览器试玩不接入账号后端。

数据库通过事务、行锁和唯一索引保证重复请求不重复导入、重复计通关或重复扣道具。每个对局每关最多记一次通关。服务验证关卡顺序、状态变化、经验单调和数值上限；本阶段不是完整战斗服务器，不将这些检查称为完全防作弊。

## 充值与广告基础

额外库存独立于每关免费炸弹和支援；存档更新不能修改道具库存。已有库存、流水、支付订单和广告奖励记录表。内部 `grantInventory()` 根据已验证来源编号发放，并事务去重；没有对外发放接口。

当前没有启用付款、广告或回调发奖接口。后续接入时须使用符合小游戏账号能力的平台方案，服务端核验支付或奖励资格后才调用发放，不能根据客户端“付款成功”“已看完广告”直接发道具。实际支付资格、商品、价格、广告位和验证方式须在接入时确定。

数据库与服务日志、备份、部署命令由 [部署说明](../deploy/README.md) 维护。日志保留用户内部编号、请求编号、对局编号和存档版本，不记录授权头、登录凭证或密钥。
