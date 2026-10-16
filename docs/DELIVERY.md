# LinguaLens 项目交付

## 1. 项目目录结构

目录树与各模块职责见 [README 项目目录](../README.md#项目目录)。项目采用 `entrypoints`、`components`、`utils`、`types` 分离结构。

## 2. 核心文件完整代码

[CORE-SOURCE.md](CORE-SOURCE.md) 按文件列出完整源代码，不使用省略号替代实现。两个 workflow 单独位于 [ci.yml](../.github/workflows/ci.yml) 与 [release.yml](../.github/workflows/release.yml)。`pnpm-lock.yaml` 保留于仓库，二进制图标保留于 `public/`。

## 3. gh 创建仓库及 Secrets 的完整命令

```bash
cd /path/to/LinguaLens-Chrome-Extension
gh auth status
git init -b main
git add .
git commit -m "feat: initialize LinguaLens BYOK translation extension"
gh repo create lingualens --public --source=. --description "BYOK Chrome 翻译插件" --push

# 以下须换成真实凭据，不能使用示例值运行。
gh secret set CHROME_EXTENSION_ID --body "你的扩展ID"
gh secret set CHROME_CLIENT_ID --body "xxx.apps.googleusercontent.com"
gh secret set CHROME_CLIENT_SECRET --body "xxx"
gh secret set CHROME_REFRESH_TOKEN --body "xxx"
gh secret list
```

未配置 Git 提交身份时，先设置本仓库的 `git config user.name` 和 `git config user.email`。未登录 GitHub 时先运行 `gh auth login`。已完成的仓库初始化和推送不要重复运行。

## 4. 本地开发调试与版本发布

```bash
npm exec --yes --package=pnpm@10.15.1 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@10.15.1 -- pnpm dev
# Chrome 中打开 chrome://extensions，开启开发者模式并加载 WXT 输出目录。

pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm zip

# 修改已提交且工作区干净后：
npm version patch && git push --follow-tags
```

Chrome Web Store 凭据申请、首次条目创建、开发模式加载与 tag 发布细节见 [README](../README.md)。真实测试结果与未验证的边界见 [verification.md](verification.md)。
