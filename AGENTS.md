# 战机时代工程约定

## 目标与入口

产品名「战机时代 / FIGHTER ERA」。零依赖原生 Canvas 竖屏射击客户端，桌面采用深空蓝和金色成长档案界面，手机显示完整游戏。浏览器与微信小游戏共享引擎、渲染器和本地素材；逻辑画布固定 405 × 720。网站 `/` 为 `index.html` 单文件字数统计工具，输入只在浏览器即时处理，不上传或保存；`/game` 和 `/game/` 为 `game.html` → `src/browser.js`，页面以根目录 base 解析图集，不能因尾斜杠导致素材请求错误。微信入口 `game.js`，配置 `game.json` 与 `project.config.json`；两个 HTML 均排除出微信包。用户提供的六张透明 PNG 图集在 `assets/`，新增两张位于 `assets/expansion/` 微信分包；客户端不引入未经任务需要的远程素材、字体或构建依赖。账号后端独立位于 `backend/`，使用 Node.js 22、Fastify 5、PostgreSQL 17；不能把后端依赖或密钥打入微信包。

游戏画面包含星空、远景行星、战舰（`warship`）和敌对行星（`planet`）。100 关分为 10 个星域，每 10 关切换一套背景配色；固定 84 颗星点分层向下循环，星云与远景天体完全离屏后复用，不添加大图、逐帧渐变、模糊或离屏画布分配。背景时钟在菜单、登机、战斗之间连续，暂停和结果页面冻结。左侧生命条使用固定高度、比例和数值表达生命，不随本局等级增加而无限延长。开始按钮文案为「驾驶战机出击」。

## 契约

- `src/engine.js` 使用 UMD 导出 `{ Game, WIDTH, HEIGHT, STAGES, validateCheckpoint }`：浏览器 `window.Shooter`，微信 / Node `require('./src/engine.js')`。`STAGES` 为冻结的 100 关配置，`game.stageCount` 与其长度一致，`game.stage` 从 0 到 99，`game.stageConfig` 在 `prepareStage()` 更新。章节为 0–9，不能用关卡索引直接访问 10 个背景。末关 BOSS 击败进入胜利，前 99 关进入升级。
- `new Game({ profile: { version: 2, totalXp: 0 }, checkpoint: null, onEvent: (name, payload) => {}, bestScore: 0 })`；方法 `start()`、`update(dtSeconds)`、`moveBy(dx, dy)`、`pause()`、`resume()`、`home()`、`chooseUpgrade(id)`、`getProfile()`、`callSupport()`、`useBomb()`。引擎必须验证档案版本与经验范围，不能接受 NaN、负数、非整数或超出安全整数范围的经验。
- `game.progression` 为 `{ level, xp, nextXp, tier, title, totalXp }`，由本局经验派生；每次经验变化发 `progression`，升级时另发 `levelup`。`getProfile()` 返回独立快照，不把可变的内部状态直接交给存储。
- 续关接口为 `getCheckpoint()`、`setSavedCheckpoint(snapshotOrNull)`、`continueRun()`、`restoreCheckpoint(snapshot)`，`game.savedCheckpoint` 为只读快照，渲染器据此显示 `continue` 按钮。加载只能通过公开方法，禁止平台直接修改引擎字段。`setSavedCheckpoint()` 只允许菜单或结算状态，不发保存事件；无可恢复记录时 `continueRun()` 返回 `false`。
- 状态为 `menu / launching / playing / ejecting / paused / upgrade / gameover / victory`。平台通过 `game.state` 处理操作，不要直接篡改战斗状态。
- 每次 `start()` / 重开先进入 `launching`，3.2 秒登机起飞后进入战斗；致命伤先进入 `ejecting`，2.6 秒弹射逃生后才结算 `gameover`。`cinematicTime` 只在动画期间递增；期间冻结战斗、禁用移动。`isActive()` 包括战斗及两种动画；`pause()` 保存 `pausedFrom`，`resume()` 恢复原态，后台和长帧必须暂停动画而非跳过。动画 `cinematic` 事件包含 `phase: launch / eject` 和关卡。下一关升级仍直接进入战斗。
- BOSS 登场启动 `bossWarningTime = bossWarningDuration = 2.4`，渲染三次柔和红色边缘脉冲并优先显示「BOSS 出现」。计时只随战斗推进、暂停冻结；BOSS 击败、己方致命伤、结算、回机库及新局须清理。`boss` 事件包含 `phase: appeared / defeated`、`stage`、`enemyId`，同一 BOSS 的击败事件只能发一次。升级与最终胜利分别明确显示 BOSS 已击败，失败明确显示我方战机已被击败。
- `src/assets.js` 使用 UMD 导出 `{ manifest, frames, loadAssets }`：浏览器 `window.ShooterAssets`；`await loadAssets(createImage)` 返回 `{images, frames}`。浏览器传 `() => new Image()`，微信传 `() => wx.createImage()`。六张图集须全部解码并验证尺寸后才允许渲染与开局；加载中明确显示状态，失败或超时给出素材路径并停止，不用旧矢量图静默兜底。微信先 `wx.loadSubpackage({name:'fleet-assets'})`，显示进度；失败、无效任务或 30 秒超时均停止。资源分包也须保留 `assets/expansion/game.js` 入口，符合本机官方编译器要求。分包成功后再解码图片；窗口改变仍保留当前加载阶段。主包和扩展包分别检查资源预算，不能因新增素材直接放宽主包限制。
- `src/renderer.js` 使用 UMD 导出 `{ Renderer }`：浏览器 `window.ShooterRenderer`；实例 `new Renderer(ctx, assets)`，`draw(game, renderTimeSeconds)`、`getButtons(game)`。用 `drawImage` 源矩形取精灵，保留原始宽高比。邻近轮廓重叠的帧可包含 `regions`，每项是绝对源坐标 `{x,y,w,h}`，在帧内且互不重叠，渲染共享同一比例与原点；不能把邻架机头/尾焰带入当前帧。图集仅做 PNG 无损重新压缩，必须保留原始 RGBA 像素与透明度。非行星敌人必须有明确 `appearance:{sheet,index,rotation}`，禁止按敌人 ID 猜素材；新 `enemyVariants` 10 款朝上，用 π 旋转，`fleet` 10 款朝右，用 π/2 旋转。BOSS 的 `form` 明确为 `fighter / warship`，血条放在旋转后的高度之上，敌方整体保持红色色系。
- 按钮布局返回 `{ id, label, x, y, w, h, disabled }`，单位为逻辑坐标。ID 为 `start / restart / continue / pause / resume / home / support / bomb / upgrade:spread / upgrade:rapid / upgrade:repair`。浏览器真实透明 DOM 按钮必须与这些几何数据及禁用状态同步，且键盘焦点可见；按 ID 复用节点，倒计时更新不能替换正在接收触摸的节点。微信禁用按钮仍占用本次触摸，不触发技能、不穿透成拖动。R / B 分别为浏览器救援 / 轰炸快捷键，只在战斗中响应首次按下。
- 平台负责 ctx 的 DPR / 黑边映射；渲染器使用逻辑坐标，不重置为物理屏幕尺寸。正常帧间隔不超过 0.25 秒时必须完整传给引擎，由引擎细分模拟，不能截短时间导致低帧率游戏变慢。超过 0.25 秒时，`playing / launching / ejecting` 状态显式暂停、重置时钟并给出诊断；菜单、升级、结算等非战斗状态只重置时钟，不把正常空闲调度当故障。暂停恢复时重置时钟。
- 只跟踪第一根有效手指；相对拖动、按钮优先、释放后自动开火。切后台 / 失焦暂停，回前台不自动继续。
- 每关救援与轰炸弹各一次，`prepareStage()` 补满 `supportCharges / bombCharges`。`callSupport()` / `useBomb()` 在非战斗或用尽时明确返回 `false`，成功返回 `true`。救援生成两架 `allies`，`supportTime / supportDuration` 表达 8 秒剩余 / 总时长，含入场和撤离；援军子弹沿用 `playerBullets` 碰撞路径，带 `source: 'support'`。暂停冻结援军，过关或己方被击败终止救援。
- 额外道具库存通过 `setInventory({bomb,support})` 更新，与每关免费次数分开。默认 `callSupport()` / `useBomb()` 只消耗免费次数；`source='inventory'` 仅供已收到服务端扣除确认的平台调用，不能自行把免费次数不足当作库存消费。技能按钮显示免费次数与库存之和；救援或轰炸效果进行中不得再次扣除同类道具。
- 轰炸立即击败所有与画面相交的活敌（包括 BOSS），清除所有敌弹；保留我方、援军、已有增益、拾取物和本次击杀掉落。屏外敌人不计奖励；BOSS 最后处理，所有击杀均按正常规则发经验与结算事件，不能重复奖励。`bombTime / bombDuration` 为 0.9 秒特效；升级和胜利面板下仍衰减此特效，不能推进冻结的战斗，暂停时冻结。全局爆炸粒子最多 320 个，批量清屏不得无限堆积。

## 肉鸽成长与存档

- 每次新出击从第 1 关、Lv.1、零经验和基础火力开始。本局最多 100 关；死亡立即清空经验、等级、武器强化和续关点，不等待 2.6 秒弹射动画结束；最终胜利也结束本局成长。最高分和历史通关记录仅作为成绩，不增强下一局。返回机库、暂停或关闭时仍存活的对局可继续。
- 致命伤前的 `resultProgression` 与战机外观只用于弹射及结算展示，不能写回 `getProfile()` 或作为复活授权。`gameover / victory` 不能安装正生命续关点；`continueRun()` 只在菜单且存在存活存档时成功。目前真实广告和充值未接入，失败界面只说明待开放，不提供假广告或免费复活按钮。未来续命必须先设计并验证服务端奖励资格，不能把旧存档直接装回。
- `profile` 为 `{version:2,totalXp:nonnegativeSafeInteger}`；`game.progression` 由本局经验派生。四个称号为 Lv.1 游隼、Lv.3 破晓、Lv.6 雷霆、Lv.10 星曜；十款外观随本局 Lv.1–10 解锁，索引 `Math.min(level,10)-1`。没有玩法等级上限，但序列化值受安全整数范围约束。最低射击间隔 0.07 秒，达上限后升级改为 +0.4 伤害。
- 本地成长与续关必须原子保存为同一个 `fighter-era.run.v2` 值：`{version:2,profile,checkpoint}`。浏览器保存 JSON 字符串，微信保存对象；每次 `progression / checkpoint / gameover / victory` 以及终局 `state:ejecting/victory/gameover` 同步保存；终局状态必须先写本机零档和最高分，再调用云队列或可选音效，避免后续异常阻止死亡落盘。不得分开写经验和续关，以免死亡半写导致复活。没有存活 checkpoint 时经验必须为零。
- 原 `fighter-era.profile / fighter-era.checkpoint` 旧版键保留但不导入本局，发现后明确提示肉鸽规则更新。最高分继续使用 `neon-wing.best-score`，致命伤或最终胜利时立即写入更高纪录。
- 续关点为严格版本 2：`phase / stage / seed / randomState / entityId / totalTime / score / kills / runStartXp / totalXp / player:{hp,maxHp,weaponLevel} / fireInterval / damageBonus / freeCharges:{bomb,support}`。`runStartXp=0`，`totalXp` 是关卡边界经验，不能高于档案经验。构造时同时提供 profile 和 checkpoint；孤立经验档案不建立存活对局。继续时回退到边界经验，和边界生命、火力、分数一致，不重复刷该关已获得的经验。
- `phase='stage'` 从关卡开头重新生成波次；`phase='upgrade'` 恢复 BOSS 击败后的选择界面，不重复奖励。只接受正生命，末关不能保存升级界面。开局、BOSS 击败、选升级、使用免费技能更新续关；同关续关保留已消耗免费次数，进入下一关才补满。`checkpoint` 事件可先于状态变化，平台不能按旧状态猜保存结果。
- 存档损坏、读取或写入失败须明确诊断并禁用该键后续写入，保留原数据。无云服务时可在明确临时游玩提示下使用初始档案；云上下文或队列失败必须停止入口，不能覆盖未知归属的记录。最高分存储单独管理失败状态。

## 云存档与后端

- 浏览器仍只保存当前来源的本机档案，不调用账号后端。微信适配 `src/wechat-cloud.js` 使用无第三方依赖的 `src/cloud-save.js`；公开配置 `src/cloud-config.js` 的 `apiBase` 默认空，显示「云存档待配置 · 当前仅本机保存」，不调用真实登录。启用前必须准备小游戏 AppSecret、HTTPS 服务地址及微信 request 合法域名；AppSecret 和数据库凭据只在服务器，不能写入客户端或公开仓库。
- 身份链路为 `wx.login()` → `POST /v1/auth/wechat` → 服务端兑换 `openid` → 自有 Bearer token。用户身份只能由服务端令牌确定，不能信任客户端提交的用户编号。当前保存账号标识、本局经验、最高分、通关纪录、续关点和道具库存；没有获取头像或昵称。微信 `session_key` 不下发、不入库；自有 token 数据库仅存 SHA-256 摘要。
- 接口事实源为 `backend/src/schemas.js`、`backend/src/store.js` 和 [后端说明](backend/README.md)。保护接口包括 `GET /v1/me`、`POST /v1/me/import`、`PUT /v1/me/save`、`POST /v1/inventory/consume`。首次本地导入仅允许新账号，不能覆盖已有云档。存档采用 `expectedRevision` 与事务行锁；每次变更带 UUID `mutationId`，相同编号、相同内容重试不重复结算，相同编号不同内容必须拒绝。409 冲突显式提示并停止自动覆盖。
- `WechatCloud.prepare()` 在登录前验证 `fighter-era.cloud-context`（META），登录后先发送已有 outbox 再读取当前账号。首次导入必须同时满足 META 为空、outbox 的 `accountId` 为 `null`、服务端 `migrationAllowed=true`；只有从未绑定账号的本机记录有资格导入。已绑定账号的本机镜像永不再次导入，切换账号和同账号重登均不得放宽。成功 prepare 必须先同步写 META 绑定身份，再由入口写云档镜像；上下文校验、队列发送或绑定写入失败都停止入口并保留原本机记录，不能把中断写入后的云档误判为未绑定本机记录。
- 对局 `stage` 和 checkpoint `stage` 从 0 到 99；`stageResults.stage` 与 `highestClearedStage` 从 1 到 100。失败或胜利的对局不可再修改；新开与续关都使用新 `run.id`。同一对局同一关最多计一次通关；恢复升级选择不把上一对局的 BOSS 再算一次通关。终局快照必须在下一局开始前同步入队，不能让下一局覆盖终局。
- 云待发送队列使用 `fighter-era.cloud-outbox`，上下文使用 `fighter-era.cloud-context`，均为版本 2。旧版 outbox 先完整归档到 `fighter-era.cloud-outbox.legacy-v1`，丢弃旧规则游戏提交但保留账号归属和未确认道具扣除请求；归档失败或已有不同归档必须报错停止。旧 META 保留账号约束但不能恢复旧对局上下文。每次 progression、checkpoint、终局以及切后台都先同步保存队列；请求在边界或每 10 秒异步发送，未知结果保留原 `mutationId` 与正文重试。队列最多保留 100 个待同步对局，不能静默丢弃超限记录。存储失败、账号不匹配、版本冲突和网络错误都必须可见；网络重试显示次数。`apiBase` 已配置但云登录失败时明确提示错误并停止开局，避免新进度后来被旧云档覆盖；只有空 `apiBase` 才是默认本机模式。已有云账号与本机经验不自动相加。
- 每关免费技能不是账号库存，不发道具流水。额外 `bomb / support` 库存通过事务扣除并记录 `inventory_ledger`，游戏先暂停、收到扣除确认后才使用；网络结果未知时保留请求，不能再次扣除或假装成功。库存与存档版本分别维护，普通存档不能修改库存。
- 已建立支付订单与广告奖励记录表及内部幂等发放方法；付款、广告播放、回调验签、充值商品、广告位和外部发奖接口均未启用。后续必须先确定平台能力与服务端验证流程；不能因客户端自称付款成功或看完广告就发道具，不能把预留结构描述为已开通充值。
- `002_roguelike_saves.sql` 为前向迁移：清空旧版账号经验与续关，并将旧存活对局标记结束，保留身份、库存、最高分及通关记录；旧版提交不可恢复。服务启动前执行事务迁移并核验摘要，失败即停止；已应用迁移不得改写。日志保留请求编号、内部用户编号、对局编号和版本，不记录 AppSecret、token、登录 code 或授权头。`GET /health/ready` 可报告数据库 ready 同时微信 pending_configuration，不能据此宣称真实微信登录已可用。

## 独立服务器与备份

- 服务专用目录为 `/opt/fighter-era`，Compose 配置位于 `/opt/fighter-era/deploy`，项目名 `fighter-era`。**绝不修改 `/opt/learning-workbench` 或其应用、数据库、配置与运行服务**；所有部署和备份操作仅针对战机时代自己的 Compose 项目、卷与目录。
- 公网浏览器试玩由独立 `web` 容器提供，HTTP 端口默认为 8080，静态目录 `/opt/fighter-era/playtest` 只放工具首页和游戏公开资源。域名 `resetshi.work` 与 `www.resetshi.work` 的 A 记录指向 `47.116.38.160`。独立 Caddy 网关以 `deploy/compose.https.yaml` 显式启用，仅发布 TCP 443；首页工具地址为 `https://resetshi.work/`，游戏地址为 `https://resetshi.work/game`，`/api/*` 剥离前缀后转发 `api-https:4317`，其它路径转发 `web:4173`。TLS-ALPN-01 验证与自动续期使用 443，禁用 HTTP challenge 和自动跳转，不监听已有应用的 80。证书与 ACME 账户使用专属持久卷，不能提交或删除。只更新首页/静态路由时同步两个 HTML 与 server.js，仅重启 web，不重建 API、数据库或网关。
- 2026-10-04 为备案准备，按用户要求在阿里云暂停 `resetshi.work` 的 `@` 与 `www` 两条 A 记录；控制台均显示「暂停」，更新时间为 15:22:37（UTC+8），原值与 TTL 600 秒保留。仅暂停 DNS，服务和 HTTPS 配置未停用。备案期间不得把域名无法解析当作部署故障而自行恢复，须由用户另行要求后启用。
- HTTPS 覆盖配置将 API 与网关接入专属内部网络 `172.31.247.0/29`，网关固定 `172.31.247.2`。后端启用 `TRUST_PROXY_HOPS=1` 必须同时配置此精确 `TRUST_PROXY_ADDRESS`，只信任直接网关的单跳转发地址；默认 0 不信任代理，非法或缺失配置须启动失败。新增网络前核对冲突；HTTPS 已启用时更新 API 要同时指定两个 Compose 配置文件，不能丢失网络和可信代理约定。
- 浏览器试玩仅同一来源本机存档，没有微信账号登录；HTTP 8080 与 HTTPS 的存档不自动迁移。API 宿主映射仍仅 `127.0.0.1:8088`；PostgreSQL 17 不发布宿主机端口。配置放 `deploy/.env` 并限制为 600；数据库用独立随机凭据，应用数据库角色不是超级用户。AppSecret、微信 request 合法域名和客户端 `apiBase` 仍待配置；HTTPS 可用不代表微信登录、广告或支付已开通。不要提交 `.env`、密钥、日志或备份。
- 运行、健康检查、更新、备份与独立恢复演练按 [部署说明](deploy/README.md)。`deploy/backup.sh` 用 `pg_dump --format=custom` 写 `/opt/fighter-era/backups`，只在成功且非空后把 `.partial` 改为正式备份。每日计时器由服务器 systemd 管理，备份失败必须可查日志。已有备份文件不等于验证过恢复或异机容灾；新验证结果应明确记录其范围。

## 运行与检查

`npm start` → `node server.js`，默认绑定 `127.0.0.1:4173`；允许 `PORT` 覆盖，`HOST` 只接受 `127.0.0.1 / 0.0.0.0`，容器使用后者。端口占用必须报错，不可静默切换。静态服务必须采用公开资源白名单，拒绝路径穿越、根目录外文件、私有环境配置、后端源码及 Git 数据；只允许 GET / HEAD。

`npm run check` 检查客户端入口语法。`npm test` 使用 Node 内置执行器运行 `tests/*.test.js`。后端需要 Node.js 22：`npm --prefix backend ci`、`npm --prefix backend run check`、`npm --prefix backend test`。真实 PostgreSQL 测试另提供 `TEST_DATABASE_URL`，数据库名称必须以 `_test` 结尾；未设置时明确跳过，不能宣称集成测试通过。客户端不需要安装后端依赖即可试玩。修改战斗逻辑时维护确定性引擎测试；界面或输入改动后检查实际浏览器中的开始、续关、移动、暂停、升级、失败 / 胜利和键盘按钮。微信适配必须单独在开发者工具及真机上验证，不能将浏览器通过写成微信通过。

## 错误与诊断

严重错误应停止循环并显示上下文。存储 / 音频属于可选能力，失败时明确向玩家提示并输出原始异常，不能静默 catch。浏览器调试入口 `window.fighterEra`，微信入口 `GameGlobal.fighterEra`；旧 `neonWing` 别名暂保留兼容。日志记录 `state / stage / boss / cinematic / ability / upgrade / levelup / gameover / victory`；`ability` 包含类型、阶段（called / ended / detonated）、关卡与剩余次数或结束原因，轰炸另记击杀目标数及清除敌弹数。微信菜单与按钮触摸额外记录 `control`，包含逻辑坐标、按钮、禁用状态和视口，便于诊断输入映射。不要记录每次 `progression / shot / hit` 或拖动移动。避免逐帧日志以及为单个页面状态编写掩盖根因的补丁。

微信版目前无音频。`project.config.json` 中 AppID 由开发者工具和项目账号管理，不要用 `touristappid` 覆盖用户已选定的测试号或正式 AppID；测试身份不能代替正式发布身份。变更平台契约、运行方式、验证范围或长期规则时，同步更新本文件和 README。

肉鸽版本于 2026-10-03 通过客户端 143 项自动测试、服务器后端 26 项测试（7 项单元、19 项真实 PostgreSQL；均 0 失败、0 跳过）。实际浏览器验证死亡后刷新不能续关，以及存活「出击 → 暂停 → 回机库 → 刷新 → 继续第 1 关」；检查时控制台无警告或错误。服务器 web/API/数据库健康；已在对应阿里云轻量应用服务器防火墙添加 TCP 8080、来源 0.0.0.0/0，原有规则未改动。公网 http://47.116.38.160:8080/ 可打开并出击，12 项公开资源均 HTTP 200 且与本地发布内容一致，私有路径返回 404。浏览器试玩为本机存档。此次微信验证为 API 模拟，未重新完成开发者工具或真机测试。

域名与 HTTPS 于 2026-10-04 完成：主域名与 `www` A 记录经公共解析验证，HTTPS 严格证书验证及实际浏览器出击通过，12 项公开资源内容一致、5 项私有路径 404。代理配置本地和服务器 13 项测试均通过，0 失败、0 跳过；公网探针与请求日志确认真实客户端地址，数据库就绪但微信仍待配置。四个独立容器健康，既有应用关键文件和容器身份未改变，HTTP 正常。独立备份完成；此次未重跑客户端全量、数据库集成或恢复演练。证书自动续期已配置，实际续期尚待观察，详见部署说明。

此前永久成长版浏览器已实测战斗升到 2 级、刷新保留等级与经验，以及 320 / 390 像素宽度布局。微信开发者工具已确认编译、菜单渲染、点击出击、实战自动射击、战舰出现和升到 3 级后的外观变化；重新编译后菜单保留经验。已在模拟器实测单指相对拖动；多指、边缘触控仍需专项核验，尚未完成真机兼容或发布审核验证。后续测试完成后更新此范围，不能扩大描述。

此前续关与云存档版本通过客户端 125 项自动测试（0 失败、0 跳过），包含账号隔离、首次迁移、登录失败停止开局、待同步记录持久化与道具扣除确认。在浏览器实测「开局 → 暂停 → 回机库 → 刷新」，菜单仍显示「继续第 1 关」，控制台无警告或错误。后端已在服务器独立测试库通过 23 项测试（7 项单元、16 项 PostgreSQL，0 跳过），备份恢复与既有应用保护检查见 [部署说明](deploy/README.md)。测试与恢复库已清理，生产库没有保留测试用户。

下面记录的是此前本地游戏版本的验证；客户端当前自动化结果以执行报告为准。真实微信账号登录、微信真机 HTTPS 请求、跨设备恢复、支付、广告和真机续关尚未验证，API 模拟或数据库测试不能替代这些验证。

此前素材接入通过 42 项自动检查。浏览器 390 × 844 实测新图集战机、敌机、子弹、自动射击、暂停与等级变化；微信开发者工具实测新图集菜单中的 Lv.9 战机、实战敌机与战舰、自动射击、单指相对拖动及暂停。

登机、弹射与 BOSS 提示版本通过语法检查和 53 项自动测试，覆盖真实波次触发的三关 BOSS、动画冻结战斗、暂停恢复与延迟单次结算。浏览器实测登机、动画暂停恢复、接入战斗及失败结算；微信开发者工具实测登机动画、接入自动射击和「我方战机已被击败」结算提示。复用实际渲染器的独立视觉场景用于检查八种动画及结果画面，不代表真实战斗通关。真机仍未验证。

援军与滚动背景版通过 64 项自动测试，增加技能次数、援军射击与暂停、轰炸保留拾取物、BOSS 单次奖励、粒子上限和微信技能触摸检查。浏览器实测援军出现、轰炸清屏、用尽按钮禁用与暂停，控制台无新增警告或错误；微信开发者工具实测两架援军出现及协同射击、轰炸清屏与正常获得升级经验。独立视觉场景检查三关配色、向下滚动和清屏后拾取物保留。尚无真机帧率测量，不将固定对象数量或模拟测试表述为真机性能保证。

100 关与扩展舰队版通过语法检查和 81 项自动测试，覆盖真实波次调度到全部 100 个 BOSS、99 次过关升级与最终胜利，以及全部关卡的外观、朝向和十套背景。新增 20 款素材仅做无损压缩，主包源文件约 3.85 MiB、扩展包约 3.02 MiB；这是本地打包范围统计，不是上传后的平台包体结果。浏览器实测新版开局、自动射击、救援、轰炸和暂停，控制台无警告或错误；微信开发者工具实测新版编译、100 关菜单、出击和自动射击。独立固定视觉场景检查第 50、99、100 关及两种 BOSS 形态，不代表实战通关。全关卡持续模拟未发现敌机或弹幕无限累积，仍无真机帧率测量。
## 仓库与提交

公开 GitHub 仓库为 `https://github.com/NoahWorld/fighter-era`，默认分支为 `main`。代码、图集、测试与文档一并维护；`project.private.config.json` 是本地开发者工具偏好，必须保持忽略。风险较高的重构或实验仍先创建独立分支，确认当前工作区状态后再操作。
