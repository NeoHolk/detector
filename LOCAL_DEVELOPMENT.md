# 本地开发指南

本文档介绍如何在本地运行 Apple 系统状态监控脚本。

## 📋 前置要求

- Node.js 18 或更高版本
- pnpm、npm 或 yarn 包管理器

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
# 或使用 pnpm
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 文件为 `.env`:

```bash
cp .env.example .env
```

编辑 `.env` 文件,填入你的企业微信 Webhook URL:

```env
# 企业微信 Webhook URL (必需)
WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=你的key

# 是否强制发送报告 (可选)
FORCE_REPORT=false
```

### 3. 运行监控脚本

```bash
npm run monitor
```

## 🧪 测试功能

### 测试 1: 正常监控(只在有异常时推送)

```bash
npm run monitor
```

### 测试 2: 强制发送报告(验证配置是否正确)

临时设置环境变量:

```bash
# macOS/Linux
FORCE_REPORT=true npm run monitor

# 或者修改 .env 文件中的 FORCE_REPORT=true
npm run monitor
```

## 📊 预期输出

正常执行时,你会看到类似的输出:

```
========== Apple 系统状态监控 开始 ==========
⏱️  执行时间: 2026-03-02 11:45:30

[监控脚本] 启动浏览器...
[监控脚本] 访问 Apple 状态页面...
[监控脚本] 等待状态表格加载...
[监控脚本] 提取服务数据...
[监控脚本] ✅ 成功获取 45 个服务状态
[监控脚本] 浏览器已关闭

[统计] 服务状态分布:
  ✅ 正常: 45
  ⚠️ 降级: 0
  ❌ 停机: 0
  ❓ 未知: 0

[推送] ✅ 所有服务正常,无需推送
========== Apple 系统状态监控 结束 ==========
```

## 🔍 故障排查

### 问题 1: 缺少 .env 文件

**错误**: `❌ 错误: WEBHOOK_URL 环境变量未设置`

**解决**: 
```bash
cp .env.example .env
# 然后编辑 .env 文件,填入正确的 WEBHOOK_URL
```

### 问题 2: Playwright 浏览器未安装

**错误**: `Executable doesn't exist at ...`

**解决**:
```bash
npx playwright install chromium
```

### 问题 3: 依赖未安装

**错误**: `Cannot find module 'dotenv'`

**解决**:
```bash
npm install
```

### 问题 4: 推送失败

**错误**: `[推送] ❌ 推送失败`

**检查**:
1. 确认 WEBHOOK_URL 格式正确
2. 确认企业微信机器人仍然有效
3. 检查网络连接

## 📝 环境变量说明

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `WEBHOOK_URL` | ✅ 是 | - | 企业微信机器人 Webhook URL |
| `FORCE_REPORT` | ❌ 否 | `false` | 是否强制发送报告(即使所有服务正常) |

## 🔄 与 GitHub Actions 的区别

| 特性 | 本地运行 | GitHub Actions |
|------|----------|----------------|
| 配置方式 | `.env` 文件 | GitHub Secrets |
| 执行方式 | 手动运行 | 定时自动执行 |
| 用途 | 开发测试 | 生产监控 |

## 💡 提示

- `.env` 文件已被 `.gitignore` 忽略,不会提交到 Git
- `.env.example` 是模板文件,可以提交到 Git
- 本地测试时建议使用 `FORCE_REPORT=true` 验证配置
- GitHub Actions 使用 Secrets,不需要 `.env` 文件

## 🆘 需要帮助?

查看完整的 GitHub Actions 配置指南: [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)
