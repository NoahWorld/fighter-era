# 战机时代工程约定

## 目标与入口

产品名「战机时代 / FIGHTER ERA」。零依赖原生 Canvas 竖屏射击游戏，桌面采用深空蓝和金色成长档案界面，手机显示完整游戏。浏览器与微信小游戏共享引擎、渲染器和本地素材；逻辑画布固定 405 × 720。浏览器入口 `index.html` → `src/browser.js`；微信入口 `game.js`，配置 `game.json` 与 `project.config.json`。用户提供的六张透明 PNG 图集在 `assets/`，新增两张位于 `assets/expansion/` 微信分包；不引入未经任务需要的远程素材、字体或构建依赖。

游戏画面包含星空、远景行星、战舰（`warship`）和敌对行星（`planet`）。100 关分为 10 个星域，每 10 关切换一套背景配色；固定 84 颗星点分层向下循环，星云与远景天体完全离屏后复用，不添加大图、逐帧渐变、模糊或离屏画布分配。背景时钟在菜单、登机、战斗之间连续，暂停和结果页面冻结。左侧生命条使用固定高度、比例和数值表达生命，不随永久等级增加而无限延长。开始按钮文案为「驾驶战机出击」。

## 契约

- `src/engine.js` 使用 UMD 导出 `{ Game, WIDTH, HEIGHT, STAGES }`：浏览器 `window.Shooter`，微信 / Node `require('./src/engine.js')`。`STAGES` 为冻结的 100 关配置，`game.stageCount` 与其长度一致，`game.stage` 从 0 到 99，`game.stageConfig` 在 `prepareStage()` 更新。章节为 0–9，不能用关卡索引直接访问 10 个背景。末关 BOSS 击败进入胜利，前 99 关进入升级。
- `new Game({ profile: { version: 1, totalXp: 0 }, onEvent: (name, payload) => {}, bestScore: 0 })`；方法 `start()`、`update(dtSeconds)`、`moveBy(dx, dy)`、`pause()`、`resume()`、`home()`、`chooseUpgrade(id)`、`getProfile()`、`callSupport()`、`useBomb()`。引擎必须验证档案版本与经验范围，不能接受 NaN、负数、非整数或超出安全整数范围的经验。
- `game.progression` 为 `{ level, xp, nextXp, tier, title, totalXp }`，由累计经验派生；每次经验变化发 `progression`，升级时另发 `levelup`。`getProfile()` 返回独立快照，不把可变的内部状态直接交给存储。
- 状态为 `menu / launching / playing / ejecting / paused / upgrade / gameover / victory`。平台通过 `game.state` 处理操作，不要直接篡改战斗状态。
- 每次 `start()` / 重开先进入 `launching`，3.2 秒登机起飞后进入战斗；致命伤先进入 `ejecting`，2.6 秒弹射逃生后才结算 `gameover`。`cinematicTime` 只在动画期间递增；期间冻结战斗、禁用移动。`isActive()` 包括战斗及两种动画；`pause()` 保存 `pausedFrom`，`resume()` 恢复原态，后台和长帧必须暂停动画而非跳过。动画 `cinematic` 事件包含 `phase: launch / eject` 和关卡。下一关升级仍直接进入战斗。
- BOSS 登场启动 `bossWarningTime = bossWarningDuration = 2.4`，渲染三次柔和红色边缘脉冲并优先显示「BOSS 出现」。计时只随战斗推进、暂停冻结；BOSS 击败、己方致命伤、结算、回机库及新局须清理。`boss` 事件包含 `phase: appeared / defeated`、`stage`、`enemyId`，同一 BOSS 的击败事件只能发一次。升级与最终胜利分别明确显示 BOSS 已击败，失败明确显示我方战机已被击败。
- `src/assets.js` 使用 UMD 导出 `{ manifest, frames, loadAssets }`：浏览器 `window.ShooterAssets`；`await loadAssets(createImage)` 返回 `{images, frames}`。浏览器传 `() => new Image()`，微信传 `() => wx.createImage()`。六张图集须全部解码并验证尺寸后才允许渲染与开局；加载中明确显示状态，失败或超时给出素材路径并停止，不用旧矢量图静默兜底。微信先 `wx.loadSubpackage({name:'fleet-assets'})`，显示进度；失败、无效任务或 30 秒超时均停止。资源分包也须保留 `assets/expansion/game.js` 入口，符合本机官方编译器要求。分包成功后再解码图片；窗口改变仍保留当前加载阶段。主包和扩展包分别检查资源预算，不能因新增素材直接放宽主包限制。
- `src/renderer.js` 使用 UMD 导出 `{ Renderer }`：浏览器 `window.ShooterRenderer`；实例 `new Renderer(ctx, assets)`，`draw(game, renderTimeSeconds)`、`getButtons(game)`。用 `drawImage` 源矩形取精灵，保留原始宽高比。邻近轮廓重叠的帧可包含 `regions`，每项是绝对源坐标 `{x,y,w,h}`，在帧内且互不重叠，渲染共享同一比例与原点；不能把邻架机头/尾焰带入当前帧。图集仅做 PNG 无损重新压缩，必须保留原始 RGBA 像素与透明度。非行星敌人必须有明确 `appearance:{sheet,index,rotation}`，禁止按敌人 ID 猜素材；新 `enemyVariants` 10 款朝上，用 π 旋转，`fleet` 10 款朝右，用 π/2 旋转。BOSS 的 `form` 明确为 `fighter / warship`，血条放在旋转后的高度之上，敌方整体保持红色色系。
- 按钮布局返回 `{ id, label, x, y, w, h, disabled }`，单位为逻辑坐标。ID 为 `start / restart / pause / resume / home / support / bomb / upgrade:spread / upgrade:rapid / upgrade:repair`。浏览器真实透明 DOM 按钮必须与这些几何数据及禁用状态同步，且键盘焦点可见；按 ID 复用节点，倒计时更新不能替换正在接收触摸的节点。微信禁用按钮仍占用本次触摸，不触发技能、不穿透成拖动。R / B 分别为浏览器救援 / 轰炸快捷键，只在战斗中响应首次按下。
- 平台负责 ctx 的 DPR / 黑边映射；渲染器使用逻辑坐标，不重置为物理屏幕尺寸。正常帧间隔不超过 0.25 秒时必须完整传给引擎，由引擎细分模拟，不能截短时间导致低帧率游戏变慢。超过 0.25 秒时，`playing / launching / ejecting` 状态显式暂停、重置时钟并给出诊断；菜单、升级、结算等非战斗状态只重置时钟，不把正常空闲调度当故障。暂停恢复时重置时钟。
- 只跟踪第一根有效手指；相对拖动、按钮优先、释放后自动开火。切后台 / 失焦暂停，回前台不自动继续。
- 每关救援与轰炸弹各一次，`prepareStage()` 补满 `supportCharges / bombCharges`。`callSupport()` / `useBomb()` 在非战斗或用尽时明确返回 `false`，成功返回 `true`。救援生成两架 `allies`，`supportTime / supportDuration` 表达 8 秒剩余 / 总时长，含入场和撤离；援军子弹沿用 `playerBullets` 碰撞路径，带 `source: 'support'`。暂停冻结援军，过关或己方被击败终止救援。
- 轰炸立即击败所有与画面相交的活敌（包括 BOSS），清除所有敌弹；保留我方、援军、已有增益、拾取物和本次击杀掉落。屏外敌人不计奖励；BOSS 最后处理，所有击杀均按正常规则发经验与结算事件，不能重复奖励。`bombTime / bombDuration` 为 0.9 秒特效；升级和胜利面板下仍衰减此特效，不能推进冻结的战斗，暂停时冻结。全局爆炸粒子最多 320 个，批量清屏不得无限堆积。

## 永久成长与存档

- 每局 100 关。单局分数、局内武器强化与永久经验分开；重新开始或返回机库不得清空永久经验。升级提升永久火力与生命上限。波次间隔、移动速度、敌弹速度和 BOSS 射速必须有边界；局内极速机炮最短间隔为 `game.minFireInterval = 0.07` 秒，达到上限后改为 +0.4 伤害，选择说明必须同步，避免 99 次升级造成无界射速。
- 四个成长称号固定为 Lv.1 游隼、Lv.3 破晓、Lv.6 雷霆、Lv.10 星曜；十款外观分别在 Lv.1–10 解锁，渲染图集索引为 `Math.min(level, 10) - 1`，不改变成长数值与存档契约。星曜后保持第十款外观，等级仍继续增长，不设置玩法等级上限。序列化数值仍受 JavaScript 安全整数范围约束。
- 档案键 `fighter-era.profile`：浏览器保存 JSON 字符串，微信保存对象，结构 `{version:1,totalXp:nonnegativeSafeInteger}`。必须在 `progression` 事件同步保存，不依赖逐帧检查、结算或切后台才写入，避免未结算击杀经验丢失。
- 最高分继续使用 `neon-wing.best-score` 保留旧纪录，仅在 `gameover / victory` 事件发现更高纪录时写入；旧键是有意保留的兼容协议。
- 档案损坏、格式不符或读取失败时，显式诊断后可使用本会话临时初始档案，但必须禁用该键写入，保护原数据。写失败也禁用后续写入并持续提示。最高分和经验存档分别管理失败状态，不能把一个键损坏误判为全部存储不可用。

## 运行与检查

`npm start` → `node server.js`，仅绑定 `127.0.0.1:4173`；允许 `PORT` 覆盖。端口占用必须报错，不可静默切换。静态服务必须拒绝路径穿越和根目录外文件。

`npm run check` 检查所有入口语法。`npm test` 使用 Node 内置执行器运行 `tests/*.test.js`。修改战斗逻辑时维护确定性引擎测试；界面或输入改动后检查实际浏览器中的开始、移动、暂停、升级、失败 / 胜利和键盘按钮。微信适配必须单独在开发者工具及真机上验证，不能将浏览器通过写成微信通过。

## 错误与诊断

严重错误应停止循环并显示上下文。存储 / 音频属于可选能力，失败时明确向玩家提示并输出原始异常，不能静默 catch。浏览器调试入口 `window.fighterEra`，微信入口 `GameGlobal.fighterEra`；旧 `neonWing` 别名暂保留兼容。日志记录 `state / stage / boss / cinematic / ability / upgrade / levelup / gameover / victory`；`ability` 包含类型、阶段（called / ended / detonated）、关卡与剩余次数或结束原因，轰炸另记击杀目标数及清除敌弹数。微信菜单与按钮触摸额外记录 `control`，包含逻辑坐标、按钮、禁用状态和视口，便于诊断输入映射。不要记录每次 `progression / shot / hit` 或拖动移动。避免逐帧日志以及为单个页面状态编写掩盖根因的补丁。

微信版目前无音频。`project.config.json` 中 AppID 由开发者工具和项目账号管理，不要用 `touristappid` 覆盖用户已选定的测试号或正式 AppID；测试身份不能代替正式发布身份。变更平台契约、运行方式、验证范围或长期规则时，同步更新本文件和 README。

当前浏览器已实测战斗升到 2 级、刷新保留等级与经验，以及 320 / 390 像素宽度布局。微信开发者工具已确认编译、菜单渲染、点击出击、实战自动射击、战舰出现和升到 3 级后的外观变化；重新编译后菜单保留经验。已在模拟器实测单指相对拖动；多指、边缘触控仍需专项核验，尚未完成真机兼容或发布审核验证。后续测试完成后更新此范围，不能扩大描述。

此前素材接入通过 42 项自动检查。浏览器 390 × 844 实测新图集战机、敌机、子弹、自动射击、暂停与等级变化；微信开发者工具实测新图集菜单中的 Lv.9 战机、实战敌机与战舰、自动射击、单指相对拖动及暂停。

登机、弹射与 BOSS 提示版本通过语法检查和 53 项自动测试，覆盖真实波次触发的三关 BOSS、动画冻结战斗、暂停恢复与延迟单次结算。浏览器实测登机、动画暂停恢复、接入战斗及失败结算；微信开发者工具实测登机动画、接入自动射击和「我方战机已被击败」结算提示。复用实际渲染器的独立视觉场景用于检查八种动画及结果画面，不代表真实战斗通关。真机仍未验证。

援军与滚动背景版通过 64 项自动测试，增加技能次数、援军射击与暂停、轰炸保留拾取物、BOSS 单次奖励、粒子上限和微信技能触摸检查。浏览器实测援军出现、轰炸清屏、用尽按钮禁用与暂停，控制台无新增警告或错误；微信开发者工具实测两架援军出现及协同射击、轰炸清屏与正常获得升级经验。独立视觉场景检查三关配色、向下滚动和清屏后拾取物保留。尚无真机帧率测量，不将固定对象数量或模拟测试表述为真机性能保证。

100 关与扩展舰队版通过语法检查和 81 项自动测试，覆盖真实波次调度到全部 100 个 BOSS、99 次过关升级与最终胜利，以及全部关卡的外观、朝向和十套背景。新增 20 款素材仅做无损压缩，主包源文件约 3.85 MiB、扩展包约 3.02 MiB；这是本地打包范围统计，不是上传后的平台包体结果。浏览器实测新版开局、自动射击、救援、轰炸和暂停，控制台无警告或错误；微信开发者工具实测新版编译、100 关菜单、出击和自动射击。独立固定视觉场景检查第 50、99、100 关及两种 BOSS 形态，不代表实战通关。全关卡持续模拟未发现敌机或弹幕无限累积，仍无真机帧率测量。
## 仓库与提交

公开 GitHub 仓库为 `https://github.com/NoahWorld/fighter-era`，默认分支为 `main`。代码、图集、测试与文档一并维护；`project.private.config.json` 是本地开发者工具偏好，必须保持忽略。风险较高的重构或实验仍先创建独立分支，确认当前工作区状态后再操作。
