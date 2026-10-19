<p align="center">
  <img src="docs/readme/hero.svg" width="100%" alt="LinguaLens — 自带密钥的 Chrome 网页翻译插件" />
</p>

<p align="center">连接自己的 AI 服务，原地翻译网页。原文、译文、双语，随时切换。</p>

<p align="center">
  <a href="https://github.com/wangshub/lingualens/actions/workflows/ci.yml"><img src="https://github.com/wangshub/lingualens/actions/workflows/ci.yml/badge.svg" alt="CI 构建状态" /></a>
  <a href="https://github.com/wangshub/lingualens/releases/latest"><img src="https://img.shields.io/github/v/release/wangshub/lingualens?color=2563eb&amp;label=GitHub" alt="GitHub 最新发行版本" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-64748b" alt="MIT 开源协议" /></a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/lingualens/aahmiimoiagmedkmnogojilladlfecgg?hl=zh-cn"><strong>添加至 Chrome</strong></a> ·
  <a href="https://github.com/wangshub/lingualens/releases/latest">下载 ZIP</a> ·
  <a href="docs/CONFIGURATION.md">配置指南</a>
</p>

![LinguaLens 双语对照：每段原文下方显示译文，页面浮层可切换显示方式](docs/readme/bilingual.jpg)

<sub>真实插件界面；演示页面通过本地模拟 API 返回预设译文，用于展示排版与交互。</sub>

## 为阅读而设计

- **原地翻译**：右键翻译选区或整页，保留链接、加粗和页面交互。
- **双语对照**：译文显示在每个自然段下方，随时切回原文或纯译文。
- **译文缓存**：同一页面内切换显示方式直接复用结果，无需再次请求模型；刷新后清除。
- **流式输出**：按段落分批处理，实时显示译文，失败段落保留原文并支持单独重试。
- **自带密钥**：兼容 OpenAI 格式的 API，支持多套模型配置、目标语言和自定义 Prompt。

默认 Prompt 要求忠实原文、不增译、不漏译；实际翻译质量取决于模型与指令。

## 开始使用

需要 **Chrome 123+**。

1. 在 [Chrome 应用商店](https://chromewebstore.google.com/detail/lingualens/aahmiimoiagmedkmnogojilladlfecgg?hl=zh-cn) 点击「添加至 Chrome」，安装后固定插件图标。
2. 打开插件设置，填写 API Base URL、API Key 和模型名称，选择目标语言，测试连接后保存。
3. 在网页中右键翻译选区或整页，用弹窗或页面浮层切换原文、译文和双语对照。

手动安装可下载 [GitHub Release ZIP](https://github.com/wangshub/lingualens/releases/latest)，解压后在 `chrome://extensions` 开启开发者模式，加载包含 `manifest.json` 的目录。商店版本经过审核后更新，可能晚于 GitHub Release。

| 服务 | API Base URL | 示例模型 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| Ollama | `http://localhost:11434/v1` | `qwen3:8b` |

模型名称以服务商可用列表为准；免鉴权服务可留空 API Key。密钥保存在浏览器本地，翻译文本仅发送至配置的服务。更多设置见 [配置指南](docs/CONFIGURATION.md) 和 [隐私说明](PRIVACY.md)。

<details>
<summary>查看模型设置与插件弹窗</summary>

![模型与翻译设置，使用本地模拟 API 与测试配置](docs/screenshots/options.png)

<img src="docs/screenshots/popup.png" width="360" alt="插件弹窗：模型选择、目标语言与翻译操作" />

</details>

## 本地开发

基于 **WXT · Manifest V3 · TypeScript · React · Tailwind CSS**。需要 Node.js 22.12+ 和 pnpm 10.15.1。

```bash
git clone https://github.com/wangshub/lingualens.git
cd lingualens
pnpm install --frozen-lockfile
pnpm dev        # 热更新，加载 .output/chrome-mv3-dev/
pnpm check      # 类型检查、Lint、单元测试、构建
pnpm zip        # 生成安装 ZIP
```

项目结构与浏览器调试见 [开发指南](docs/DEVELOPMENT.md)。

## 版本发布

提交修改后执行：

```bash
npm version patch && git push --follow-tags
```

GitHub Actions 自动检查、生成 ZIP 与 GitHub Release，再通过 V2 API 提交商店更新，审核通过后自动发布。支持从 Actions 检查商店状态或重新提交指定 Release；版本保护、OAuth 与 Secrets 配置见 [发布指南](docs/RELEASING.md)。

---

[MIT License](LICENSE) · [隐私说明](PRIVACY.md) · [完整源码](docs/CORE-SOURCE.md) · [验证记录](docs/verification.md)
