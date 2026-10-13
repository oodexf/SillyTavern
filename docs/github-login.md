# GitHub 登录

启用后，登录页（`/login`）显示"使用 GitHub 登录"按钮，用户通过 GitHub OAuth 授权后登录到对应的 SillyTavern 账户。

## 配置步骤

1. 在 <https://github.com/settings/developers> 新建 OAuth App，"Authorization callback URL" 填 `https://<你的域名>/auth/github/callback`（本机使用时为 `http://127.0.0.1:8000/auth/github/callback`）。
2. 在 `config.yaml` 中设置：

```yaml
enableUserAccounts: true

sso:
  github:
    enabled: true
    clientId: "<Client ID>"
    clientSecret: ""          # 建议改用环境变量 SILLYTAVERN_SSO_GITHUB_CLIENTSECRET
    allowedUsers: [你的GitHub用户名]
    accountMapping:
      你的GitHub用户名: default-user
```

3. 重启服务器。启动日志会显示 `GitHub login is enabled.`；配置不完整时会给出警告，并保持原有的密码登录。

## 配置项

| 配置 | 默认值 | 说明 |
|---|---|---|
| `sso.github.enabled` | `false` | 开关。需要同时开启 `enableUserAccounts` 并填写 `clientId` 与 `clientSecret` 才会生效 |
| `sso.github.callbackUrl` | 空 | 发给 GitHub 的回调地址，留空时按请求地址生成。反向代理终止 HTTPS 时需要显式填写 |
| `sso.github.allowedUsers` | `[]` | 允许登录的 GitHub 用户名（不区分大小写），留空表示不限制 |
| `sso.github.accountMapping` | `{}` | GitHub 用户名到已有账户 handle 的映射，首次登录时建立关联 |
| `sso.github.autoCreateUsers` | `false` | 为未关联的 GitHub 账号自动创建新账户（非管理员，头像取自 GitHub）。请与 `allowedUsers` 一起使用 |
| `sso.github.allowPasswordLogin` | `false` | 是否保留用户名与密码登录 |

## 行为说明

- **账户匹配：** 首次登录后，账户按 GitHub 的数字 ID 关联并保存在用户记录中（`github.id`、`github.login`），之后改 GitHub 用户名不影响登录；同名的其他 GitHub 账号无法冒用已关联的账户。
- **仅 GitHub 登录（默认）：** `/api/users/login` 与找回密码接口返回 403，登录页不显示账户列表，"单个无密码用户自动登录"不再生效。Authelia、Authentik 与按用户的 Basic Auth 不受影响。
- **网络：** 服务器需要能访问 `github.com` 与 `api.github.com`。这些请求遵循 `requestProxy` 配置。
- **错误提示：** 登录失败时跳回 `/login?github_error=<代码>`，登录页显示对应提示，详细原因输出在服务器控制台。
