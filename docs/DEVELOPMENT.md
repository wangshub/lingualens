# 开发指南

需要 Node.js 22.12+ 和 pnpm 10.15.1。未安装 pnpm 时，可用 `npm exec --yes --package=pnpm@10.15.1 -- pnpm <命令>` 运行下列命令。

## 项目结构

```text
LinguaLens-Chrome-Extension/
├── entrypoints/
│   ├── background.ts              # 右键菜单、配置测试与请求代理
│   ├── content.ts                 # 选区快照、页面命令和生命周期
│   ├── options/{index.html,main.tsx,Options.tsx}
│   └── popup/{index.html,main.tsx,Popup.tsx}
├── components/                    # 品牌、反馈、设置加载 hook
├── utils/
│   ├── api.ts                     # SSE、超时与 API 错误
│   ├── background-translation.ts  # 分批、调度与退避重试
│   ├── content-transport.ts        # Port 流式事件和保活
│   ├── translation-controller.ts  # 原译文缓存、显示切换、段落回滚
│   ├── bilingual.ts               # 段落双语渲染、源节点校验
│   ├── dom.ts                     # TreeWalker、过滤、Unicode 切片
│   ├── protocol.ts                # JSONL 增量解码与完整性校验
│   ├── page-toolbar.ts            # ShadowRoot 状态与单段重试
│   ├── settings.ts                # 本地配置、校验、URL 规范化
│   ├── scheduler.ts               # 后台全局并发上限
│   ├── defaults.ts
│   └── messaging.ts
├── types/index.ts
├── assets/app.css                 # Tailwind CSS 与界面样式
├── public/                        # 图标及其原生 SVG
├── tests/                         # 单元测试与真实扩展 E2E
├── scripts/                       # 版本核验、图标、完整源码导出
├── docs/                          # 完整源码、交付和验证记录
├── .github/workflows/{ci.yml,release.yml}
├── wxt.config.ts
├── package.json
├── pnpm-lock.yaml
├── PRIVACY.md
└── LICENSE
```

各核心文件的完整代码见 [CORE-SOURCE.md](CORE-SOURCE.md)，两份 workflow 也完整收录。

## 本地开发与调试

```bash
pnpm install --frozen-lockfile
pnpm dev                       # WXT 开发服务器，热更新
pnpm typecheck                 # tsc --noEmit
pnpm lint
pnpm test
pnpm build                     # wxt build
pnpm zip                       # wxt zip
pnpm docs:source               # 重新导出完整核心源码
```

本项目禁用 WXT 自动启动浏览器；运行 `pnpm dev` 后，自行加载开发输出 `.output/chrome-mv3-dev/`。生产包输出为 `.output/chrome-mv3/` 和 `.output/lingualens-版本号-chrome.zip`。

在 `chrome://extensions` 中查看 Service Worker 控制台；内容脚本在网页开发者工具里调试。修改清单权限或更新插件后，刷新测试网页。不要把真实 API Key 写入代码、测试、`.env` 提交或截图。

### 真实浏览器验证

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```

E2E 在隔离的临时浏览器配置中加载真实插件，启动本地模拟 API，验证设置持久化、脱敏、401、整页流式替换、DOM 身份与点击事件、失败回滚、单段重试、跨标签选区、取消还原和弹窗动作。不使用真实 API Key，不产生模型调用费用。结果和截图写入已忽略的 `artifacts/`、`test-results/`。

## 界面截图

`docs/screenshots/` 保存真实扩展加载后的自动化截图，使用本地模拟 API 与测试配置，不代表真实服务商的翻译质量。发布前可替换为正式截图。

## 官方实现参考

- [WXT Manifest 与版本号](https://wxt.dev/guide/essentials/config/manifest.html)
- [WXT 打包与提交商店](https://wxt.dev/guide/essentials/publishing.html)
- [Chrome contextMenus API](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)
- [OpenAI Chat Completions streaming 事件格式](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)

[返回 README](../README.md)
