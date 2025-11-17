# 部署指南 - GitHub 协作与 Render 部署

## 📋 场景说明

- **仓库所有者**: 你的 GitHub 账号（拥有完整权限）
- **合作者**: 使用其 GitHub 账号创建的 Render 账号
- **目标**: 代码在你的账号下管理，但通过合作者的 Render 账号部署

## 🔐 GitHub 协作设置

### 1. 邀请合作者

1. 进入你的 GitHub 仓库
2. 点击 `Settings` → `Collaborators and teams`
3. 点击 `Add people` 按钮
4. 输入合作者的 GitHub 用户名或邮箱
5. 选择权限级别：
   - **Write** (推荐): 可以推送代码、创建分支、合并 PR
   - **Maintain**: 额外可以管理仓库设置（但无法删除仓库）
   - **Admin**: 完整权限（不推荐，除非完全信任）

6. 点击 `Add [username] to this repository`

### 2. 合作者接受邀请

- 合作者会收到邮件通知
- 或在 GitHub 通知中心看到邀请
- 点击接受邀请

### 3. 验证权限

合作者现在应该能够：
- 看到你的私有仓库
- 克隆仓库
- 创建分支和推送代码（如果给了 Write 权限）

## 🚀 Render 部署设置

### 1. 使用合作者账号登录 Render

- 合作者使用其 GitHub 账号登录 Render
- 授权 Render 访问 GitHub

### 2. 连接仓库

1. 在 Render Dashboard 点击 `New` → `Web Service`
2. 在 "Connect a repository" 中：
   - 选择你的 GitHub 账号（如果看不到，确保合作者已接受邀请）
   - 选择 `musight-backend` 仓库
3. Render 会自动检测 `render.yaml` 配置

### 3. 环境变量配置

在 Render Dashboard 的 Environment 标签页添加以下变量：

```env
NODE_ENV=production
JWT_SECRET=your-super-secret-jwt-key-change-this
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
SPOTIFY_REDIRECT_URI=https://your-app.onrender.com/api/auth/callback
```

**注意**: `DATABASE_URL` 会自动从连接的 PostgreSQL 数据库获取，无需手动设置。

### 4. 首次部署后的数据库迁移

部署完成后，需要在 Render Shell 中运行数据库迁移：

1. 在 Render Dashboard 中，进入你的 Web Service
2. 点击 `Shell` 标签页
3. 运行以下命令：

```bash
npm run prisma:generate
npx prisma migrate deploy
```

或者，如果使用开发模式：

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 5. 验证部署

1. 检查服务状态是否为 "Live"
2. 访问 `https://your-app.onrender.com/health`
3. 应该返回: `{"status":"ok","timestamp":"..."}`

## 🔄 持续部署流程

### 推荐的协作流程

1. **开发流程**:
   ```
   你的账号: 创建功能分支 → 开发 → 提交 PR
   合作者: 审查代码 → 批准 → 合并到主分支
   ```

2. **自动部署**:
   - Render 会自动检测主分支的推送
   - 自动触发构建和部署
   - 无需手动操作

3. **保护主分支** (可选但推荐):
   - Settings → Branches → Add rule
   - 选择 `main` 分支
   - 启用 "Require pull request reviews before merging"
   - 至少需要 1 个审查者

## 🔒 安全最佳实践

### 1. 环境变量管理

- ✅ **敏感信息**: JWT_SECRET, SPOTIFY_CLIENT_SECRET 等
- ✅ **权限控制**: 只有你（仓库所有者）应该知道这些值
- ✅ **共享方式**: 使用安全的方式分享（如 1Password, Bitwarden）

### 2. 代码审查

- ✅ 所有代码变更通过 Pull Request
- ✅ 至少一人审查后才能合并
- ✅ 重要功能需要你的最终批准

### 3. 访问控制

- ✅ 定期审查合作者权限
- ✅ 如果不再需要，及时移除访问权限
- ✅ 监控仓库活动（Settings → Insights → Network）

## 📝 常见问题

### Q: 合作者看不到我的私有仓库？

**A**: 确保：
1. 已发送邀请
2. 合作者已接受邀请
3. 合作者使用正确的 GitHub 账号登录 Render

### Q: Render 无法连接仓库？

**A**: 
1. 检查合作者的 GitHub 账号是否已授权 Render
2. 在 Render 中重新授权 GitHub 访问
3. 确保仓库在合作者可见的仓库列表中

### Q: 如何更新环境变量？

**A**: 
1. 在 Render Dashboard 中进入 Web Service
2. 点击 `Environment` 标签页
3. 添加或修改环境变量
4. 点击 `Save Changes`
5. Render 会自动重新部署

### Q: 数据库迁移失败？

**A**: 
1. 检查 `DATABASE_URL` 是否正确
2. 确保数据库已创建（在 Render Dashboard 的 Databases 中）
3. 在 Shell 中手动运行迁移命令
4. 检查 Prisma schema 是否正确

## 🎯 总结

- ✅ 代码在你的 GitHub 账号下，你拥有完全控制权
- ✅ 合作者可以协助开发和部署
- ✅ Render 通过合作者的账号连接，但代码所有权在你
- ✅ 使用 Pull Request 流程确保代码质量
- ✅ 敏感信息由你管理，确保安全性

