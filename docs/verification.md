# 实际验证记录

日期：2026-10-16。环境：Node.js 22.22.0、pnpm 10.15.1、WXT 0.20.27、TypeScript 5.9.3、React 19.3.1、Tailwind CSS 4.3.3、Playwright Chromium 156.0.8078.4。

## 2026-10-17 发布 CLI 与 V2 API

- 新发布脚本直接使用 Chrome Web Store V2，保留用户 OAuth 客户端和 refresh token 认证，增加 V2 必需的 Publisher ID 配置。Google 公布的 [V1 支持截止日](https://developer.chrome.com/docs/webstore/api/v1) 为 2026-10-15；原 WXT 发布依赖仍调用 V1，因此 CI 改为运行独立脚本。
- 类型检查、Lint、57 项单元测试和生产构建通过。新增 20 项测试使用模拟响应与虚构凭据，覆盖只读状态检查、异步上传轮询、失败后停止提交、保护现有审核、认证错误及凭据保密。
- 两个 CLI 的 `--help` 可运行，工作流 YAML 语法检查通过。凭据导入工具从权限为 `600` 的 gcloud 用户 ADC 文件读取三项 OAuth 值，通过标准输入调用 `gh secret set`。
- 本机安装 Google Cloud CLI 589.0.0，位置为未入库的 `artifacts/tools/google-cloud-sdk/`。完整归档经长度、gzip 完整性校验后解压，`gcloud --version` 与授权命令帮助可运行；隔离配置中的账号列表为空。核对 SDK 源码后，CLI 示例采用受支持的浏览器流程及所需 scope，没有使用已被 SDK 拒绝的自有客户端与 `--no-launch-browser` 组合。
- 用户已创建商店条目并反馈状态为待审核。目前尚未创建 OAuth 客户端，V2 的真实认证、上传及提交审核均未执行。本轮未重复运行插件的浏览器交互测试。

## v1.1.0 缓存与双语验证

新增原文、译文和双语对照三种显示方式，页面内保留已完成译文。缓存按配置、服务地址、模型、目标语言和 Prompt 区分；取消时保留完成的段落，重新翻译或页面卸载时清除数据。

- 类型检查、Lint 和 37 项核心测试通过。新增测试覆盖缓存复用、连续选区、配置失效、数字节点变化、页面节点替换、双语安全格式与取消后的部分结果保留。
- 7 组真实扩展 Playwright 测试通过。模拟 API 端统计确认：完整译文在原文、译文、双语之间反复切换，新增翻译请求为 0；正文一个段落发生修改时，仅新增 1 个对应段落的请求。另行验证语言、模型和 Prompt 修改会使结果失效。
- 双语译文的位置在原文下方；原始链接节点身份和点击事件保留，链接、加粗及代码能在对照区域显示。译文按纯文本写入，源 ID、事件属性和危险 URL 不进入附加区域。
- `wxt zip` 与版本检查通过，包内 manifest 和 package 版本均为 1.1.0。
- 已实际查看新版弹窗和页面对照截图，并完成一轮独立静态视觉检查。按评审合并重复入口，完成态主按钮改为「重新翻译」。本轮未打分，原有入场与按钮动效沿用，未单独重做动画专项评审。

新版截图位于 `docs/screenshots/popup.png` 和 `docs/screenshots/bilingual.png`，使用本地模拟服务，不代表真实模型翻译质量。下面保留初始版本的验证记录。

## 已执行并通过

- `tsc --noEmit`，开启严格模式、未使用声明检查和索引访问检查。
- `eslint . --max-warnings 0`。
- `vitest run`：4 个文件，24 个用例。覆盖 SSE 网络分片/UTF-8/CRLF/CR、普通 JSON 回退、响应截断、401/429、网络超时、用户取消、JSONL 缺失及重复编号、编码预算、并发队列、跨内联标签选区、段落回滚、单段重试、恢复时拒绝迟到响应、应用框架修改文本、Unicode 切片和原始空白。
- `wxt build` 与 `wxt zip`，安装包 `.output/lingualens-1.0.0-chrome.zip`；ZIP 根目录含 `manifest.json`，不含依赖目录或环境文件。
- `node scripts/check-version.mjs --manifest`：package 和 manifest 均为 1.0.0，Manifest V3。
- WXT 开发服务器在 `127.0.0.1:39173` 启动成功，生成 `.output/chrome-mv3-dev/`；验证后已关闭服务。
- `wxt submit --help` 在 pnpm 等价 PATH 环境下可正常执行，确认 `--chrome-zip` 与四项 Chrome 凭据受支持。未提交商店。
- 使用官方 npm 审计端点执行 `pnpm audit --prod --audit-level high`，未发现已知运行依赖漏洞。镜像源没有审计端点，审计改用官方源完成。

## 真实扩展浏览器测试

在隔离的临时 Chromium 用户目录中加载实际生产扩展，使用本地 HTTP 服务提供网页和模拟兼容 API，3 组 Playwright 测试全部通过：

1. 设置保存、刷新后重读、密码框脱敏、测试连接成功及 401、添加配置、切换默认配置。
2. 整页流式替换、原始链接和加粗元素身份、既有点击事件、代码及可编辑区域过滤、段落失败后回滚、单独重试和还原。
3. `contextmenu` 事件保存跨标签选区，翻译部分文字；取消后原文保持不被迟到响应覆盖；实际 popup 页面切换目标语言并翻译、还原。

测试未操作操作系统的原生右键菜单界面，而是经过真实 `contextmenu` 选区捕获后发送相同的扩展页面命令。注册 API 与原生 `page`/`selection` 互斥规则已按 [Chromium 官方实现](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/context_menu_helpers.cc) 核对。

本地复现命令：

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```

本机测试浏览器被隔离保存在 `artifacts/browsers/`，因此本机复跑时使用 `PLAYWRIGHT_BROWSERS_PATH=artifacts/browsers pnpm test:e2e`。普通开发机按上面的默认安装方式无需此变量。

## 视觉检查与修改

实际查看桌面设置页、420px 窄屏、380px 弹窗、200% 设置页与失败状态截图。独立视觉评审初稿评分 8.0/10，仅针对静态画面；未把该评分当成功能测试结果。

按评审处理了浮层字体不一致、部分失败却显示满蓝色进度条的问题；失败终态改为成功/失败段落数，只保留明确的单段重试；缩短设置页顶部介绍，删去侧栏重复使用说明。重新在滚动到顶部后截图，确认列表与当前表单对齐。修订稿由主 Agent 实际看图复查，没有虚构第二次独立评分。

首次进入、保存反馈和按钮按压均保存开始、中间、结束三帧；测试将原有动画或过渡放慢至 10% 以便观察，尊重减少动态效果的系统设置。证据位于未入库的 `artifacts/screenshots/motion-{entry,feedback,action}-{0,1,2}.png`。文档截图位于 `docs/screenshots/`，使用模拟服务和测试配置。

## 未执行及边界

没有使用用户真实 API Key 调用 OpenAI、DeepSeek、Moonshot 或 Ollama；不声称已验证这些服务当前的账号访问权限或实际翻译质量。协议、传输及界面已使用模拟兼容服务测试。

初始验证时尚无 Chrome Web Store 开发者条目和发布凭据，因此未执行自动商店上传。后续条目与发布工具状态见本文最新记录。GitHub 远端 CI 状态以仓库 Actions 为准。

静态扫描只处理当前文档内已渲染文本；不覆盖 Shadow DOM、伪元素、图片文字、Canvas 或浏览器 PDF 阅读器。应用框架重新生成的文本不强行覆盖，详见 [配置指南](CONFIGURATION.md)。
