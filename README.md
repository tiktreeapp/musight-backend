# Musight Backend

音乐听歌数据分析后端服务，集成 Spotify API，为 iOS App 提供数据分析和 API 服务。

## 🚀 功能特性

- ✅ Spotify OAuth 认证流程
- ✅ 自动刷新 Access Token
- ✅ 安全存储 Refresh Token
- ✅ 定时同步用户听歌数据（每天凌晨 2 点）
- ✅ 音乐数据分析 API
- ✅ 用户听歌统计
- ✅ Top Tracks & Top Artists
- ✅ 听歌时间分析

## 📋 技术栈

- **Node.js** + **Express** - Web 框架
- **PostgreSQL** - 数据库（Render 免费提供）
- **Prisma** - ORM
- **JWT** - 用户认证
- **node-cron** - 定时任务

## 🏗 项目结构

```
backend/
├── src/
│   ├── index.js              # 主入口文件
│   ├── routes/
│   │   ├── auth.js           # Spotify OAuth 回调
│   │   ├── user.js           # 用户信息
│   │   ├── stats.js          # 数据分析 API
│   │   └── spotify.js        # Spotify API 请求封装
│   ├── services/
│   │   ├── spotifyService.js # Spotify API 服务
│   │   └── analysisService.js # 数据分析服务
│   └── utils/
│       └── tokenManager.js    # Token 管理工具
├── prisma/
│   └── schema.prisma         # 数据库模型
├── package.json
└── README.md
```

## 🔧 安装与配置

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

创建 `.env` 文件（参考 `.env.example`）：

```env
# Server
PORT=3000
NODE_ENV=production

# JWT Secret
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Spotify OAuth
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
SPOTIFY_REDIRECT_URI=https://your-backend.onrender.com/api/auth/callback

# Database (Render PostgreSQL)
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
```

### 3. 设置 Spotify App

1. 访问 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. 创建新应用
3. 获取 `Client ID` 和 `Client Secret`
4. 添加重定向 URI: `https://your-backend.onrender.com/api/auth/callback`

### 4. 初始化数据库

```bash
# 生成 Prisma Client
npm run prisma:generate

# 运行数据库迁移
npm run prisma:migrate
```

## 🚀 运行

### 开发模式

```bash
npm run dev
```

### 生产模式

```bash
npm start
```

## 📡 API 端点

### 认证相关

#### `GET /api/auth/login`
获取 Spotify OAuth 授权 URL

**响应:**
```json
{
  "authUrl": "https://accounts.spotify.com/authorize?..."
}
```

#### `GET /api/auth/callback`
Spotify OAuth 回调端点（自动处理）

#### `POST /api/auth/refresh`
手动刷新 Spotify Token

### 用户相关

#### `GET /api/user/me`
获取当前用户信息（需要 Bearer Token）

**Headers:**
```
Authorization: Bearer <jwt_token>
```

#### `GET /api/user/status`
检查用户连接状态

### 统计数据

#### `GET /api/stats/dashboard`
获取完整仪表板数据

#### `GET /api/stats/listening?timeRange=7d`
获取听歌统计（timeRange: 24h, 7d, 30d, all）

#### `GET /api/stats/top-tracks?limit=20`
获取最常听的歌曲

#### `GET /api/stats/top-tracks-by-time?time_range=7d&limit=20`
获取指定时间范围内的最常听歌曲（支持 24h, 7d, 30d, all）

#### `GET /api/stats/top-artists-by-time?time_range=7d&limit=20`
获取指定时间范围内的最常听艺术家（支持 24h, 7d, 30d, all）

#### `GET /api/stats/top-artists?limit=20`
获取最常听的艺术家

#### `GET /api/stats/recent?limit=50`
获取最近播放的歌曲

### Spotify 数据

#### `POST /api/spotify/sync`
同步 Spotify 数据到数据库

#### `GET /api/spotify/recently-played?limit=50`
获取最近播放（实时数据）

#### `GET /api/spotify/top-tracks?time_range=medium_term&limit=50`
获取 Top Tracks（实时数据）

#### `GET /api/spotify/top-artists?time_range=medium_term&limit=50`
获取 Top Artists（实时数据）

## 🔄 OAuth 流程

1. **App 请求授权 URL**
   ```
   GET /api/auth/login
   ```

2. **用户授权后，Spotify 回调后端**
   ```
   GET /api/auth/callback?code=xxx
   ```

3. **后端返回 JWT Token 给 App**
   ```
   musight://auth?token=xxx&userId=xxx
   ```

4. **App 使用 JWT Token 调用 API**
   ```
   Authorization: Bearer <jwt_token>
   ```

## ⏰ 定时任务

系统会在每天 UTC 时间 2:00 AM 自动同步所有用户的听歌数据。

## 🗄 数据库模型

### User
- 用户基本信息
- Spotify Token 存储

### TrackStat
- 用户播放记录
- 歌曲信息

### ArtistStat
- 用户 Top Artists
- 艺术家信息

## 🚢 部署到 Render

### GitHub 协作设置

如果你的 Render 账号是用合作者的 GitHub 账号创建的，可以按以下步骤设置：

1. **邀请合作者到 GitHub 仓库**
   - 进入你的 GitHub 仓库
   - 点击 `Settings` → `Collaborators` → `Add people`
   - 输入合作者的 GitHub 用户名或邮箱
   - 选择权限级别：**Write** 或 **Maintain**（推荐）
     - **Write**: 可以推送代码、创建分支、合并 PR
     - **Maintain**: 除了 Write 权限，还可以管理仓库设置（但无法删除仓库）

2. **合作者接受邀请**
   - 合作者会收到邮件通知
   - 在 GitHub 上接受邀请

3. **在 Render 中连接仓库**
   - 使用合作者的 GitHub 账号登录 Render
   - 创建新的 Web Service
   - 在 "Connect Repository" 中选择你的仓库（合作者现在可以看到）
   - Render 会自动检测 `render.yaml` 配置

### 部署步骤

1. **连接 GitHub 仓库到 Render**
   - 在 Render Dashboard 点击 "New" → "Web Service"
   - 选择你的 GitHub 仓库（如果看不到，确保合作者已接受邀请）
   - Render 会自动读取 `render.yaml` 配置

2. **环境变量配置**
   - 在 Render Dashboard 的 Environment 标签页添加：
     ```
     NODE_ENV=production
     JWT_SECRET=your-super-secret-jwt-key
     SPOTIFY_CLIENT_ID=your-spotify-client-id
     SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
     SPOTIFY_REDIRECT_URI=https://your-app.onrender.com/api/auth/callback
     ```
   - `DATABASE_URL` 会自动从连接的 PostgreSQL 数据库获取

3. **数据库设置**
   - Render 会根据 `render.yaml` 自动创建 PostgreSQL 数据库
   - 首次部署后，需要在 Render Shell 中运行迁移：
     ```bash
     npm run prisma:generate
     npm run prisma:migrate deploy
     ```

4. **构建和启动命令**
   - 构建命令: `npm install && npm run prisma:generate`
   - 启动命令: `npm start`
   - 这些已在 `render.yaml` 中配置

### 权限管理建议

- ✅ **代码所有权**: 仓库在你的 GitHub 账号下，你拥有完全控制权
- ✅ **部署权限**: 合作者可以在 Render 中部署，但代码变更需要你的审核
- ✅ **最佳实践**: 
  - 使用 Pull Request 流程进行代码审查
  - 保护主分支（Settings → Branches → Add rule）
  - 重要环境变量由你管理

## 📝 注意事项

- Refresh Token 安全存储在数据库中
- Access Token 自动刷新（过期前 5 分钟）
- 所有 API 请求需要 JWT Token 认证
- 定时任务在 UTC 时间运行

## 🔒 安全建议

- 使用强 JWT Secret
- 启用 HTTPS
- 定期更新依赖
- 监控 API 使用情况

## 📄 License

MIT

