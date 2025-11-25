# Musight Backend API 文档

## 一、关于缓存策略

### 前端缓存 vs 后端缓存

**对于 iOS App，缓存应该主要由前端实现，原因：**

1. **用户体验优先**
   - 前端缓存可以立即显示数据，无需等待网络请求
   - iOS 可以使用 CoreData 或 UserDefaults 快速缓存
   - 离线访问已缓存的数据

2. **后端缓存的作用（作为 Fallback）**
   - 后端缓存主要用于：**数据库不可用时的应急方案**
   - 当数据库连接失败时，后端仍能返回数据（从本地文件缓存）
   - 主要用于开发/测试阶段，或数据库维护期间

### 建议的缓存策略

**前端（iOS App）：**
- ✅ 主要缓存层：使用 UserDefaults 或 CoreData 缓存 API 响应
- ✅ 缓存最近播放、Top歌曲、Top艺术家等常用数据
- ✅ 设置合理的过期时间（如 1 小时、24 小时）
- ✅ 网络请求失败时使用缓存数据

**后端（目前实现）：**
- ⚠️ 仅在数据库不可用时作为 Fallback
- ⚠️ 临时存储，不应依赖后端缓存作为主要存储

---

## 二、前端 API 接口汇总

### 基础信息

- **Base URL**: `https://musight-backend.onrender.com`
- **认证方式**: 所有需要认证的接口使用 `Authorization: Bearer <jwt_token>` Header

---

### 1. 认证相关 API

#### 1.1 获取 Spotify 登录 URL
```
GET /api/auth/login
```
**响应：**
```json
{
  "authUrl": "https://accounts.spotify.com/authorize?..."
}
```
**说明：** 前端打开这个 URL，用户授权后回调到 `/api/auth/callback`，后端会自动重定向到 App Scheme。

---

#### 1.2 Spotify OAuth 回调（自动处理）
```
GET /api/auth/callback?code=xxx
```
**说明：** 用户授权后，Spotify 会自动调用这个端点，后端处理后会重定向到 App。

---

#### 1.3 刷新 Spotify Token（手动）
```
POST /api/auth/refresh
Content-Type: application/json

{
  "userId": "user-uuid"
}
```

---

### 2. 用户信息 API

#### 2.1 获取当前用户信息
```
GET /api/user/me
Authorization: Bearer <token>
```
**响应：**
```json
{
  "id": "user-uuid",
  "spotifyId": "spotify-user-id",
  "displayName": "用户名",
  "avatarUrl": "https://...",
  "email": "user@example.com",
  "followers": 123,
  "createdAt": "2025-01-01T00:00:00Z"
}
```

---

#### 2.2 检查用户连接状态
```
GET /api/user/status
Authorization: Bearer <token>
```
**响应：**
```json
{
  "connected": true,
  "hasRefreshToken": true
}
```
或
```json
{
  "connected": false,
  "error": "error message"
}
```

---

### 3. 统计数据 API

#### 3.1 获取仪表板数据（综合数据）
```
GET /api/stats/dashboard
Authorization: Bearer <token>
```
**响应：**
```json
{
  "stats": {
    "timeRange": "30d",
    "totalTracks": 1234,
    "uniqueTracks": 567,
    "uniqueArtists": 89,
    "totalListeningTime": {
      "hours": 45,
      "minutes": 30,
      "totalMs": 1638000000
    },
    "topTracks": [...],
    "topArtists": [...],
    "hourlyActivity": [0, 1, 2, ...]
  },
  "topArtists": [...],
  "recentTracks": [...],
  "spotifyTopTracks": [...]
}
```

---

#### 3.2 获取听歌统计
```
GET /api/stats/listening?timeRange=7d
Authorization: Bearer <token>
```
**参数：**
- `timeRange`: `24h`, `7d`, `30d`, `all`（默认：`7d`）

**响应：**
```json
{
  "timeRange": "7d",
  "totalTracks": 456,
  "uniqueTracks": 234,
  "uniqueArtists": 45,
  "totalListeningTime": {...},
  "topTracks": [
    {
      "trackId": "xxx",
      "name": "歌曲名",
      "artist": "艺术家",
      "imageUrl": "https://...",
      "count": 12
    }
  ],
  "topArtists": [...],
  "hourlyActivity": [0, 1, 2, ...],
  "firstTrack": {...},
  "lastTrack": {...}
}
```

---

#### 3.3 获取 Top 歌曲（按时间段）
```
GET /api/stats/top-tracks?time_range=medium_term&limit=20&sync=true
Authorization: Bearer <token>
```
**参数：**
- `time_range`: `short_term`, `medium_term`, `long_term`（默认：`medium_term`）
- `limit`: 数量（默认：20）
- `sync`: `true`/`false`（是否先从 Spotify 同步，默认：`false`）

**响应：**
```json
[
  {
    "trackId": "xxx",
    "name": "歌曲名",
    "artist": "艺术家",
    "imageUrl": "https://...",
    "count": 15,
    "lastPlayed": "2025-01-01T00:00:00Z"
  }
]
```

---

#### 3.4 获取 Top 歌曲（按自定义时间范围）
```
GET /api/stats/top-tracks-by-time?time_range=7d&limit=20
Authorization: Bearer <token>
```
**参数：**
- `time_range`: `24h`, `7d`, `30d`, `all`（默认：`all`）
- `limit`: 数量（默认：20）

**响应：**
```json
[
  {
    "trackId": "xxx",
    "name": "歌曲名",
    "artist": "艺术家",
    "imageUrl": "https://...",
    "count": 15,
    "plays": 15,
    "lastPlayed": "2025-01-01T00:00:00Z"
  }
]
```
**说明：** 
- 这个接口根据数据库中存储的播放记录，按指定时间范围统计 Top 歌曲
- 支持 Last Week（`7d`）和 Last Month（`30d`）等时间段
- 与 `/api/stats/top-tracks` 不同，此接口基于本地数据库记录而非 Spotify API 的时间范围

---

#### 3.5 获取 Top 艺术家（按自定义时间范围）
```
GET /api/stats/top-artists-by-time?time_range=7d&limit=20
Authorization: Bearer <token>
```
**参数：**
- `time_range`: `24h`, `7d`, `30d`, `all`（默认：`all`）
- `limit`: 数量（默认：20）

**响应：**
```json
[
  {
    "artistId": null,
    "name": "艺术家名",
    "imageUrl": "https://...",
    "count": 15,
    "plays": 15,
    "lastPlayed": "2025-01-01T00:00:00Z"
  }
]
```
**说明：** 
- 这个接口根据数据库中存储的播放记录，按指定时间范围统计 Top 艺术家
- 支持 Last Week（`7d`）和 Last Month（`30d`）等时间段
- 与 `/api/stats/top-artists` 不同，此接口基于本地数据库记录而非 Spotify API 的时间范围

---

#### 3.4 获取 Top 艺术家
```
GET /api/stats/top-artists?time_range=medium_term&limit=20&sync=true
Authorization: Bearer <token>
```
**参数：** 同 3.3

**响应：**
```json
[
  {
    "id": "artist-uuid",
    "artistId": "spotify-artist-id",
    "name": "艺术家名",
    "genres": ["pop", "rock"],
    "imageUrl": "https://...",
    "playCount": 45,
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z"
  }
]
```

---

#### 3.5 获取最近播放（实时数据）
```
GET /api/stats/recent?limit=50
Authorization: Bearer <token>
```
**参数：**
- `limit`: 数量（默认：50，最大：50）

**响应：**
```json
[
  {
    "trackId": "xxx",
    "name": "歌曲名",
    "artist": "艺术家",
    "artistIds": ["artist-id"],
    "imageUrl": "https://...",
    "playedAt": "2025-01-01T00:00:00Z",
    "duration": 240000,
    "popularity": 75
  }
]
```
**说明：** 这个接口直接从 Spotify API 获取实时数据（代理端点）。

---

#### 3.6 获取用户音乐画像 ⭐ **推荐使用**
```
GET /api/stats/profile
Authorization: Bearer <token>
```
**响应：**
```json
{
  "topTracks": [
    {
      "trackId": "xxx",
      "name": "歌曲名",
      "plays": 12,
      "imageUrl": "https://..."
    }
  ],
  "topArtists": [
    {
      "artistId": "yyy",
      "name": "艺术家名",
      "plays": 20,
      "genres": ["pop", "rock"],
      "imageUrl": "https://..."
    }
  ],
  "genreDist": {
    "pop": 0.45,
    "rock": 0.30,
    "electronic": 0.25
  },
  "avgEnergy": 0.62,
  "avgValence": 0.48,
  "lastUpdated": "2025-01-01T00:00:00Z"
}
```
**说明：** 
- 如果画像不存在，会自动触发同步并构建
- 数据库不可用时，会从 Spotify 获取并缓存到本地文件
- **这是最推荐的接口，包含完整的用户音乐画像**

---

#### 3.7 获取 Top 播放列表
```
GET /api/stats/top-playlists?limit=20
Authorization: Bearer <token>
```
**响应：**
```json
[
  {
    "playlistId": "xxx",
    "name": "播放列表名",
    "description": "描述",
    "imageUrl": "https://...",
    "owner": "拥有者",
    "tracksCount": 50,
    "public": true
  }
]
```

---

### 4. Spotify 数据 API（实时数据）

#### 4.1 同步 Spotify 数据
```
POST /api/spotify/sync
Authorization: Bearer <token>
```
**说明：** 手动触发同步最近播放和 Top 艺术家到数据库。

---

#### 4.2 获取最近播放（Spotify API）
```
GET /api/spotify/recently-played?limit=50&after=1234567890
Authorization: Bearer <token>
```
**说明：** 直接从 Spotify API 获取（与 `/api/stats/recent` 类似）。

---

#### 4.3 获取 Top 歌曲（Spotify API）
```
GET /api/spotify/top-tracks?time_range=medium_term&limit=50
Authorization: Bearer <token>
```
**说明：** 直接从 Spotify API 获取。

---

#### 4.4 获取 Top 艺术家（Spotify API）
```
GET /api/spotify/top-artists?time_range=medium_term&limit=50
Authorization: Bearer <token>
```
**说明：** 直接从 Spotify API 获取。

---

#### 4.5 获取歌曲详情
```
GET /api/spotify/track/:trackId
Authorization: Bearer <token>
```

---

#### 4.6 获取艺术家详情
```
GET /api/spotify/artist/:artistId
Authorization: Bearer <token>
```

---

#### 4.7 获取播放列表
```
GET /api/spotify/playlists?limit=50&offset=0
Authorization: Bearer <token>
```

---

#### 4.8 获取 Top 播放列表
```
GET /api/spotify/top-playlists?limit=20
Authorization: Bearer <token>
```

---

### 5. 缓存管理 API（可选）

#### 5.1 列出所有缓存
```
GET /api/cache/list
Authorization: Bearer <token>
```

---

#### 5.2 获取特定类型的缓存
```
GET /api/cache/:dataType
Authorization: Bearer <token>
```

---

#### 5.3 导入缓存到数据库
```
POST /api/cache/import
Authorization: Bearer <token>
```
**说明：** 当数据库可用后，可以将本地缓存导入数据库。

---

#### 5.4 删除缓存
```
DELETE /api/cache/:dataType
Authorization: Bearer <token>
```

---

## 三、是否需要创建 Render 数据库？

### 当前情况分析

**如果出现以下错误，说明数据库尚未创建：**
```
Error: Prisma schema validation - (get-config wasm)
Error code: P1012
error: Error validating datasource `db`: You must provide a nonempty URL.
```

### 回答：**取决于你的使用场景**

#### ✅ **需要创建数据库的情况：**
1. **生产环境** - 需要持久化存储用户数据
2. **用户画像功能** - `/api/stats/profile` 需要数据库存储聚合数据
3. **历史数据分析** - 需要长期存储听歌记录进行统计分析
4. **多设备同步** - 用户在不同设备访问时，数据需要同步

#### ⚠️ **可以暂时不创建数据库的情况：**
1. **开发/测试阶段** - 后端已实现缓存 Fallback，可以正常工作
2. **MVP 验证** - 只需要验证功能，不需要长期存储
3. **单用户测试** - 只有你一个人在使用

### 创建 Render 数据库的步骤

1. **在 Render Dashboard 创建 PostgreSQL 数据库**
   - 登录 Render
   - 点击 "New" → "PostgreSQL"
   - 选择 Free Plan
   - 数据库会自动在 `render.yaml` 中配置

2. **运行数据库迁移**
   ```bash
   # 在 Render Shell 中执行
   npm run prisma:migrate deploy
   npm run prisma:generate
   ```

3. **验证数据库连接**
   - 检查 Render 环境变量中的 `DATABASE_URL`
   - 后端会自动检测数据库可用性

### 建议

**现在（开发阶段）：**
- ⚠️ 可以不创建数据库，使用后端缓存功能正常开发测试
- ⚠️ 前端可以正常调用所有 API，数据会缓存在后端本地文件

**生产环境前：**
- ✅ **必须创建数据库**
- ✅ 运行迁移创建表结构
- ✅ 如果有缓存数据，使用 `/api/cache/import` 导入

---

## 总结

1. **缓存策略**：前端应该实现自己的缓存（UserDefaults/CoreData），后端缓存只是 Fallback
2. **主要接口**：推荐使用 `/api/stats/profile` 获取完整音乐画像
3. **数据库**：开发阶段可以不创建，生产环境前必须创建并迁移

