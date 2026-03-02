# 快速参考 - 差异检测功能

## 🚀 快速开始

### 本地测试

```bash
# 1. 安装依赖(如果还没有)
npm install

# 2. 首次运行(建立基准数据)
npm run monitor

# 3. 再次运行(测试无变化场景)
npm run monitor

# 4. 手动修改 data/apple.json 测试差异检测
vim data/apple.json
# 将某个服务的 status 从 "operational" 改为 "degraded"

# 5. 运行查看差异通知
npm run monitor
```

### GitHub Actions

差异检测功能已自动集成,无需额外配置:
- ✅ 自动使用 Cache 持久化历史数据
- ✅ 自动检测状态变化并发送通知
- ✅ 每次运行都会更新缓存数据

## 📋 通知类型速查

| 图标 | 类型 | 触发条件 | 优先级 |
|-----|------|---------|--------|
| 🔄 | 差异通知 | 服务状态发生变化 | 最高 |
| 🚨 | 异常警报 | 有服务非正常状态 | 高 |
| ✅ | 健康报告 | 每日9点或手动触发 | 低 |

## 🎯 状态映射

| 状态代码 | 中文 | Emoji | CSS Class |
|---------|------|-------|-----------|
| `operational` | 正常 | ✅ | `light-available` |
| `degraded` | 降级 | ⚠️ | `light-resolved` |
| `down` | 停机 | ❌ | `light-unavailable` |
| `unknown` | 未知 | ❓ | 其他 |

## 📁 文件位置

```
detector/
├── data/
│   ├── .gitkeep                    # Git 占位文件
│   ├── README.md                   # 数据目录说明
│   ├── apple.json                  # 历史数据(自动生成,不提交)
│   └── apple.json.example          # 数据模板示例
├── scripts/
│   └── apple-status-monitor.ts     # 监控脚本(已更新)
├── .github/
│   └── workflows/
│       └── apple-status-monitor.yml # GitHub Actions(已更新)
├── CHANGELOG.md                    # 更新日志
├── DIFF_DETECTION_TEST.md          # 测试指南
└── README.md                       # 项目说明
```

## 🔑 关键函数

### `readHistoryData()`
读取 `data/apple.json` 中的历史数据,返回 `HistoryData | null`

### `saveHistoryData(services)`
保存当前服务状态到 `data/apple.json`

### `diffServices(oldServices, newServices)`
对比两次服务状态,返回差异数组 `ServiceDiff[]`

### `pushDiffNotification(webhookUrl, diffs)`
发送差异通知到企业微信

## 🧪 测试场景

### 场景 1: 服务降级
```json
// 修改前
{ "serviceName": "App Store Connect", "status": "operational" }

// 修改后
{ "serviceName": "App Store Connect", "status": "degraded" }

// 预期通知
✅ 正常 ➜ ⚠️ 降级
```

### 场景 2: 服务恢复
```json
// 修改前
{ "serviceName": "TestFlight", "status": "down" }

// 修改后
{ "serviceName": "TestFlight", "status": "operational" }

// 预期通知
❌ 停机 ➜ ✅ 正常
```

## 💡 常见问题

### Q: 首次运行没有差异通知?
A: 正常现象,首次运行时没有历史数据可对比。

### Q: 本地的 apple.json 会提交到 Git 吗?
A: 是的，`data/apple.json` 会被提交到 Git 仓库。本地修改后可以手动提交，或者让 GitHub Actions 自动提交最新数据。

### Q: 如何清除历史数据重新测试?
A: 可以将 `data/apple.json` 重置为空数据：
```json
{"timestamp": "2026-03-02T00:00:00.000Z", "services": []}
```

### Q: 差异通知和异常警报会同时发送吗?
A: 是的,这是两个独立的通知机制。

### Q: GitHub Actions 提交会触发新的 workflow 吗?
A: 不会，提交信息中包含 `[skip ci]` 标记，会跳过 CI 触发。

## 📚 详细文档

- 完整测试指南: [DIFF_DETECTION_TEST.md](DIFF_DETECTION_TEST.md)
- 更新日志: [CHANGELOG.md](CHANGELOG.md)
- 数据目录说明: [data/README.md](data/README.md)
- GitHub Actions: [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)
- 本地开发: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md)

## 🎉 新功能亮点

✅ 自动检测服务状态变化  
✅ 独立的差异通知模板  
✅ 支持本地和 GitHub Actions  
✅ 无需额外配置  
✅ 向后兼容现有功能  
✅ 完整的文档和测试指南  

---

**版本**: v2.0.0  
**更新日期**: 2026-03-02
