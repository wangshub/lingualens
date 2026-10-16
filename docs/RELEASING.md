# 发布指南

## 持续集成

[ci.yml](../.github/workflows/ci.yml) 在 push 到 `main` 和所有 Pull Request 时运行：checkout → pnpm → Node.js 22 与 pnpm 缓存 → 冻结锁文件安装 → TypeScript → Lint → 单元测试 → `wxt build`。成功后上传未打包的插件 artifact，下载解压即可加载审查，保留 14 天。

## Chrome Web Store 首次准备

1. 在 [Chrome Web Store 开发者控制台](https://chrome.google.com/webstore/devconsole/) 注册开发者账号，完成要求的账号验证。
2. 本地运行 `pnpm zip`，手动上传首个 zip 创建商店条目，填写商店介绍、截图、隐私说明等信息；复制扩展 ID。自动发布工具不能代替首次创建条目。
3. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建项目并启用 **Chrome Web Store API**。
4. 配置 OAuth 同意界面与授权用户；创建 **Web application** 类型的 OAuth Client，保存 Client ID 和 Client Secret。
5. 在授权重定向地址加入 `https://developers.google.com/oauthplayground`。
6. 打开 [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)，设置里勾选 **Use your own OAuth credentials**，填入刚创建的 Client ID 与 Client Secret，选择 offline 访问。
7. 输入 scope `https://www.googleapis.com/auth/chromewebstore`，授权具有该扩展发布权限的 Google 账号；点击 **Exchange authorization code for tokens**，保存返回的 **refresh token**。没有 refresh token 时重新检查 offline 访问和授权状态，不把短期 access token 填成 refresh token。
8. 把四个值存入 GitHub 仓库 Secrets。OAuth 项目测试状态可能限制令牌有效期，按 Google 当前要求调整项目发布状态；令牌被撤销或失效时重新授权。

凭据申请依据：[Chrome 官方 API 使用指南](https://developer.chrome.com/docs/webstore/using-api)。商店审核与最终上架由 Chrome Web Store 决定，CI 提交成功不等于立刻上架。

## 配置 GitHub Secrets

在项目根目录执行以下命令。示例值仅作格式说明，不应原样运行：

```bash
gh secret set CHROME_EXTENSION_ID --body "你的32位扩展ID"
gh secret set CHROME_CLIENT_ID --body "xxx.apps.googleusercontent.com"
gh secret set CHROME_CLIENT_SECRET --body "xxx"
gh secret set CHROME_REFRESH_TOKEN --body "xxx"
gh secret list
```

避免密钥进入 shell 历史时，使用交互输入：

```bash
gh secret set CHROME_EXTENSION_ID
gh secret set CHROME_CLIENT_ID
gh secret set CHROME_CLIENT_SECRET
gh secret set CHROME_REFRESH_TOKEN
```

## 发布版本

确认修改已提交，且工作区干净：

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
npm version patch && git push --follow-tags
# 也可按变更规模使用 npm version minor 或 npm version major
```

`npm version` 更新 `package.json`、创建版本提交并打 `vX.Y.Z` tag；WXT 构建时自动同步 manifest 版本。不手工编辑生成的 manifest。[release.yml](../.github/workflows/release.yml) 会校验 tag、package 和构建版本一致。

推送 tag 后，工作流运行检查和 `wxt zip`，创建带自动 changelog 和 zip 附件的 GitHub Release。配置齐全时，再用 `wxt submit` 上传并提交 Chrome Web Store 审核，批准后按商店流程发布。四项 Secret 缺失时，GitHub Release 仍生成，商店步骤会明确显示跳过原因；填齐后可重跑商店 job。

首次只发布 GitHub v1.0.0 时，可执行 `git tag v1.0.0 && git push origin v1.0.0`。如果商店已手动上传相同版本，应先递增版本号再运行自动提交，以免重复上传版本被拒绝。

## 创建仓库与首次推送

以下为从本地目录首次创建公开仓库的完整命令。已存在仓库时不重复执行 `gh repo create`。

```bash
cd /path/to/LinguaLens-Chrome-Extension
gh auth status                 # 未登录时执行 gh auth login
git init -b main
# 未设置提交身份时，在本仓库执行：
# git config user.name "你的名字"
# git config user.email "你的 GitHub noreply 邮箱"
git add .
git commit -m "feat: initialize LinguaLens BYOK translation extension"
gh repo create lingualens --public --source=. --description "BYOK Chrome 翻译插件" --push
```

`.gitignore` 排除 `node_modules`、`.wxt`、`.output`、`dist`、`.env*`、日志、测试浏览器与临时产物，保留 `pnpm-lock.yaml`。

[返回 README](../README.md)
