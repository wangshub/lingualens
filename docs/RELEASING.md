# 发布指南

发布脚本使用 Chrome Web Store API V2。Google 公布的 [V1 支持截止日](https://developer.chrome.com/docs/webstore/api/v1) 为 2026-10-15；不再使用 WXT 0.20.x 附带的旧 `wxt submit` 发布实现。

## 持续集成

[ci.yml](../.github/workflows/ci.yml) 在 push 到 `main` 和所有 Pull Request 时运行：checkout → pnpm → Node.js 22 与 pnpm 缓存 → 冻结锁文件安装 → TypeScript → Lint → 单元测试 → `wxt build`。成功后上传未打包的插件 artifact，下载解压即可加载审查，保留 14 天。

## Chrome Web Store 首次准备

1. 在 [Chrome Web Store 开发者控制台](https://chrome.google.com/webstore/devconsole/) 注册开发者账号，完成要求的账号验证。
2. 本地运行 `pnpm zip`，手动上传首个 zip 创建商店条目，填写商店介绍、截图、隐私说明等信息；复制扩展 ID，并在发布者设置中复制 **Publisher ID**。两种 ID 不相同，V2 API 都需要。
3. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建项目并启用 **Chrome Web Store API**。
4. 配置 OAuth 同意界面与授权用户；创建 **Web application** 类型的 OAuth Client，保存 Client ID 和 Client Secret。
5. 在授权重定向地址加入 `https://developers.google.com/oauthplayground`。
6. 打开 [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)，设置里勾选 **Use your own OAuth credentials**，填入刚创建的 Client ID 与 Client Secret，选择 offline 访问。
7. 输入 scope `https://www.googleapis.com/auth/chromewebstore`，授权具有该扩展发布权限的 Google 账号；点击 **Exchange authorization code for tokens**，保存返回的 **refresh token**。没有 refresh token 时重新检查 offline 访问和授权状态，不把短期 access token 填成 refresh token。
8. 把扩展 ID、Publisher ID 和三项 OAuth 凭据存入 GitHub 仓库 Secrets。外部 OAuth 应用处于 Testing 状态时，此 scope 的 refresh token 在 7 天后失效；长期 CI 应先把 OAuth 应用切换为 In production，再重新授权获取令牌。这与扩展的商店审核状态无关。参考 [Google 令牌有效期说明](https://developers.google.com/identity/protocols/oauth2#expiration)。

凭据申请依据：[Chrome 官方 API 使用指南](https://developer.chrome.com/docs/webstore/using-api)。商店审核与最终上架由 Chrome Web Store 决定，CI 提交成功不等于立刻上架。

## CLI 获取并保存凭据

CLI 仍需使用自己项目的 OAuth 客户端，并由拥有扩展发布权限的 Google 账号确认授权。首次客户端创建在 Google Cloud 控制台完成。

采用 CLI 授权时，创建 **Desktop app（桌面应用）** 类型的客户端并下载 JSON；上面的 **Web application** 类型用于 OAuth Playground 流程。安装 [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) 后，在项目目录执行：

```bash
mkdir -p artifacts/webstore-auth
chmod 700 artifacts/webstore-auth
CLOUDSDK_CONFIG="$PWD/artifacts/webstore-auth" \
  gcloud auth application-default login \
  --client-id-file="/绝对路径/client.json" \
  --scopes="openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/chromewebstore" \
  --disable-quota-project

pnpm webstore:credentials \
  --adc artifacts/webstore-auth/application_default_credentials.json \
  --repo owner/repository
```

`CLOUDSDK_CONFIG` 隔离本次授权文件。导入工具要求凭据文件权限为 `600`，只把三项 OAuth 值通过标准输入传给 `gh secret set`，不在命令参数、输出或版本库中保存值。下载的客户端 JSON 同样应保存在受限目录。`artifacts/` 已被 Git 忽略。

示例在运行 CLI 的机器上打开浏览器。远程机器需使用 `--no-browser` 并按 gcloud 的远程引导操作；自有客户端不能与 `--no-launch-browser` 合用。gcloud 还要求附带 `cloud-platform` scope；若只希望授权商店 scope，使用上面的 OAuth Playground 流程。

CLI 参数依据：[gcloud 官方说明](https://docs.cloud.google.com/sdk/gcloud/reference/auth/application-default/login)。未配置客户端、未完成浏览器授权时，CLI 无法仅凭扩展 ID 获取发布凭据。

## 配置 GitHub Secrets

在项目根目录执行以下命令。示例值仅作格式说明，不应原样运行：

```bash
gh secret set CHROME_EXTENSION_ID --body "你的32位扩展ID"
gh secret set CHROME_PUBLISHER_ID --body "你的发布者ID"
gh secret set CHROME_CLIENT_ID --body "xxx.apps.googleusercontent.com"
gh secret set CHROME_CLIENT_SECRET --body "xxx"
gh secret set CHROME_REFRESH_TOKEN --body "xxx"
gh secret list
```

避免密钥进入 shell 历史时，使用交互输入：

```bash
gh secret set CHROME_EXTENSION_ID
gh secret set CHROME_PUBLISHER_ID
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

推送 tag 后，工作流运行检查和 `wxt zip`，创建带自动 changelog 和 zip 附件的 GitHub Release。五项 Secret 配置齐全时，`scripts/chrome-webstore.mjs` 交换短期 access token，通过 V2 上传 ZIP、等待处理完成，再提交审核。脚本不会取消现有待审核或待发布版本；如存在这类提交，会停止并提示去控制台处理。五项 Secret 缺失时，GitHub Release 仍生成，商店步骤会显示跳过原因。

需要先核验认证和发布者归属时，在已安全注入五项环境变量的终端运行 `pnpm webstore --check`。此命令只交换令牌并查询状态，不上传文件或提交审核。它不会从 GitHub 读取 Secrets 的明文。API 可能只返回扩展标识而不返回版本状态，CLI 会明确显示“未返回状态”，上传流程会停止并提示去控制台核对首次审核；不能据此判断没有待审版本。

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
