# 代码迁移指南 - 拷贝到另一台电脑

## ✅ 可以直接拷贝

你可以直接拷贝整个项目文件夹到另一台电脑，但需要注意以下几点：

## 📁 需要拷贝的文件

以下文件/文件夹**必须拷贝**：

```
musight-backend/
├── src/                    ✅ 所有源代码
├── prisma/
│   └── schema.prisma      ✅ 数据库模型
├── package.json           ✅ 依赖配置
├── README.md              ✅ 文档
├── DEPLOYMENT.md          ✅ 部署指南
├── render.yaml            ✅ Render 配置
└── .gitignore             ✅ Git 忽略规则
```

## ❌ 不需要拷贝的文件

以下文件/文件夹**不需要拷贝**（会在新电脑上重新生成）：

```
node_modules/              ❌ 依赖包（很大，重新安装）
package-lock.json          ❌ 锁定文件（可选，会重新生成）
.env                       ❌ 环境变量（需要重新创建）
.env.local                 ❌ 本地环境变量
prisma/migrations/         ❌ 数据库迁移文件（可选）
.DS_Store                  ❌ macOS 系统文件
.vscode/                   ❌ IDE 配置（可选）
```

## 🚀 在新电脑上的设置步骤

### 1. 拷贝项目文件夹

使用以下方式之一：
- **U盘/移动硬盘**: 直接拷贝整个文件夹
- **Git**: 如果已推送到 GitHub，直接 `git clone`
- **云盘**: 上传到 Google Drive / Dropbox / iCloud 等

### 2. 安装 Node.js

确保新电脑已安装 Node.js（推荐 v18+）：

```bash
# 检查 Node.js 版本
node --version

# 如果没有安装，访问 https://nodejs.org/ 下载安装
```

### 3. 安装依赖

进入项目目录，安装依赖：

```bash
cd musight-backend
npm install
```

### 4. 配置环境变量

创建 `.env` 文件（参考 `.env.example` 如果存在，或根据 README 中的说明）：

```bash
# 创建 .env 文件
touch .env
```

编辑 `.env` 文件，添加必要的配置：

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# JWT Secret
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Spotify OAuth Configuration
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/api/auth/callback

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/musight?schema=public
```

### 5. 设置数据库

#### 选项 A: 使用本地 PostgreSQL

```bash
# 安装 PostgreSQL（如果还没有）
# macOS: brew install postgresql
# Windows: 下载安装包
# Linux: sudo apt-get install postgresql

# 创建数据库
createdb musight

# 生成 Prisma Client
npm run prisma:generate

# 运行数据库迁移
npm run prisma:migrate
```

#### 选项 B: 使用远程数据库（如 Render）

```bash
# 直接使用远程 DATABASE_URL
# 在 .env 中配置远程数据库连接字符串

# 生成 Prisma Client
npm run prisma:generate

# 运行数据库迁移
npm run prisma:migrate deploy
```

### 6. 验证安装

```bash
# 启动开发服务器
npm run dev

# 或生产模式
npm start
```

访问 `http://localhost:3000/health` 应该返回：
```json
{"status":"ok","timestamp":"..."}
```

## 🔄 使用 Git 的方式（推荐）

如果你已经将代码推送到 GitHub，这是最简单的方式：

### 在新电脑上：

```bash
# 1. 克隆仓库
git clone https://github.com/your-username/musight-backend.git

# 2. 进入目录
cd musight-backend

# 3. 安装依赖
npm install

# 4. 创建 .env 文件（从你的密码管理器或安全存储中获取）
# 5. 配置数据库
npm run prisma:generate
npm run prisma:migrate

# 6. 启动
npm run dev
```

## 📋 检查清单

在新电脑上完成以下检查：

- [ ] Node.js 已安装（`node --version`）
- [ ] 项目文件夹已拷贝
- [ ] 依赖已安装（`npm install`）
- [ ] `.env` 文件已创建并配置
- [ ] 数据库已连接（本地或远程）
- [ ] Prisma Client 已生成（`npm run prisma:generate`）
- [ ] 数据库迁移已运行（`npm run prisma:migrate`）
- [ ] 服务器可以启动（`npm run dev`）
- [ ] 健康检查通过（访问 `/health` 端点）

## ⚠️ 注意事项

1. **环境变量安全**: 
   - `.env` 文件包含敏感信息，不要通过不安全的方式传输
   - 使用密码管理器（1Password, Bitwarden）或加密方式分享

2. **数据库迁移**:
   - 如果使用新数据库，需要运行迁移
   - 如果使用现有数据库，确保连接字符串正确

3. **Spotify 配置**:
   - 确保 Spotify App 的重定向 URI 包含新电脑的地址（如果是本地开发）
   - 或使用 ngrok 等工具创建临时公网地址

4. **端口冲突**:
   - 确保 3000 端口未被占用
   - 或修改 `.env` 中的 `PORT` 值

## 🆘 常见问题

### Q: `npm install` 失败？

**A**: 
- 检查 Node.js 版本（需要 v16+）
- 清除缓存: `npm cache clean --force`
- 删除 `node_modules` 和 `package-lock.json`，重新安装

### Q: Prisma 迁移失败？

**A**: 
- 检查 `DATABASE_URL` 是否正确
- 确保数据库服务正在运行
- 检查数据库用户权限

### Q: 无法连接到数据库？

**A**: 
- 检查数据库服务是否启动
- 验证连接字符串格式
- 检查防火墙设置

### Q: Spotify OAuth 回调失败？

**A**: 
- 确保 `SPOTIFY_REDIRECT_URI` 与 Spotify App 设置中的 URI 完全匹配
- 本地开发使用 `http://localhost:3000/api/auth/callback`
- 生产环境使用完整的 HTTPS URL

## 📝 总结

✅ **可以拷贝**，但建议：
- 使用 Git 方式（如果已推送到 GitHub）
- 或排除 `node_modules` 和 `.env` 后拷贝
- 在新电脑上重新安装依赖和配置环境变量

