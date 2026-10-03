# 霓虹航线工程约定

## 目标与入口

零依赖原生 Canvas 竖屏射击原型。浏览器与微信小游戏共享引擎、渲染器；逻辑画布固定 405 × 720。浏览器入口 `index.html` → `src/browser.js`；微信入口 `game.js`，配置 `game.json` 与 `project.config.json`。不要引入外部素材、字体或构建依赖，除非任务明确需要。

## 契约

- `src/engine.js` 使用 UMD 导出 `{ Game, WIDTH, HEIGHT }`：浏览器 `window.Shooter`，微信 / Node `require('./src/engine.js')`。
- `new Game({ onEvent: (name, payload) => {}, bestScore: 0 })`；方法 `start()`、`update(dtSeconds)`、`moveBy(dx, dy)`、`pause()`、`resume()`、`home()`、`chooseUpgrade(id)`。
- 状态为 `menu / playing / paused / upgrade / gameover / victory`。平台通过 `game.state` 处理操作，不要直接篡改战斗状态。
- `src/renderer.js` 使用 UMD 导出 `{ Renderer }`：浏览器 `window.ShooterRenderer`；实例 `new Renderer(ctx)`，`draw(game, renderTimeSeconds)`、`getButtons(game)`。
- 按钮布局返回 `{ id, label, x, y, w, h }`，单位为逻辑坐标。ID 为 `start / restart / pause / resume / home / upgrade:spread / upgrade:rapid / upgrade:repair`。浏览器真实透明 DOM 按钮必须与这些几何数据同步，且键盘焦点可见。
- 平台负责 ctx 的 DPR / 黑边映射；渲染器使用逻辑坐标，不重置为物理屏幕尺寸。正常帧间隔不超过 0.25 秒时必须完整传给引擎，由引擎细分模拟，不能截短时间导致低帧率游戏变慢。超过 0.25 秒时显式暂停战斗、重置时钟并给出诊断；暂停恢复时重置时钟。
- 只跟踪第一根有效手指；相对拖动、按钮优先、释放后自动开火。切后台 / 失焦暂停，回前台不自动继续。

## 运行与检查

`npm start` → `node server.js`，仅绑定 `127.0.0.1:4173`；允许 `PORT` 覆盖。端口占用必须报错，不可静默切换。静态服务必须拒绝路径穿越和根目录外文件。

`npm run check` 检查所有入口语法。`npm test` 使用 Node 内置执行器运行 `tests/*.test.js`。修改战斗逻辑时维护确定性引擎测试；界面或输入改动后检查实际浏览器中的开始、移动、暂停、升级、失败 / 胜利和键盘按钮。微信适配必须单独在开发者工具及真机上验证，不能将浏览器通过写成微信通过。

## 错误与诊断

严重错误应停止循环并显示上下文。存储 / 音频属于可选能力，失败时明确向玩家提示并输出原始异常，不能静默 catch。浏览器调试入口 `window.neonWing`，微信入口 `GameGlobal.neonWing`。避免逐帧日志以及为单个页面状态编写掩盖根因的补丁。

微信版目前无音频，AppID 为待替换占位值 `touristappid`。变更平台契约、运行方式、验证范围或长期规则时，同步更新本文件和 README。
