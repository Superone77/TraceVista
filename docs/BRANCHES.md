# 分支流程

1. 从 main 创建 `feat/…`、`fix/…` 或 `chore/…` 分支。
2. 在分支上提交、验证、推送，然后创建面向 main 的 PR。
3. 等待维护者 Superone77 审批，再通过 PR 合入。

新克隆安装本机防误推钩子：

```bash
pnpm setup:hooks
```

该钩子拦截直接推送和删除远端 main。当前本机已安装。

## GitHub 强制规则

计划规则在 `.github/main-protection.json`：必须通过 PR，至少 1 个 approval，必须由 CODEOWNER 审批；新增提交使旧审批失效；规则对管理员生效，禁止强推和删除 main。

2026-10-01 配置时，GitHub API 返回 403：该私有仓库需要 Pro 权限才能启用分支保护。因此以上服务端规则目前未启用；CODEOWNERS 本次随 PR 提交。

获得相应权限后，在仓库目录执行并核对返回值：

```bash
gh api --method PUT repos/Superone77/trajactory_visualizer/branches/main/protection \
  --input .github/main-protection.json
gh api repos/Superone77/trajactory_visualizer/branches/main/protection
```

当前 CLI 登录账号也是 Superone77。GitHub 不允许作者批准自己的 PR；要由 Superone77 在 GitHub 点击 Approve，PR 应由另一提交账号创建。使用当前账号时，先由用户在聊天中审阅并明确批准，再操作该 PR；这不算 GitHub 的 approving review。
