# 实际验证记录

日期：2026-10-16。环境：Node.js 22.22.0、pnpm 10.15.1、WXT 0.20.27、TypeScript 5.9.3、React 19.3.1、Tailwind CSS 4.3.3、Playwright Chromium 156.0.8078.4。

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

没有 Chrome Web Store 开发者条目和四项发布凭据，因此未实际上传或上架商店。README 包含凭据申请、Secrets 配置和首次上传步骤。GitHub 远端 CI 状态以仓库 Actions 为准。

静态扫描只处理当前文档内已渲染文本；不覆盖 Shadow DOM、伪元素、图片文字、Canvas 或浏览器 PDF 阅读器。应用框架重新生成的文本不强行覆盖，详见 README。
