# GitHub Actions 自动监控设置指南

本项目支持使用 GitHub Actions 自动监控 Apple 系统状态,无需维护服务器。

## 🎯 如何验证脚本是否正常工作?

为了验证监控脚本是否正常运行,提供了以下几种方式:

### 方式 1: 手动触发测试 ⭐️ 推荐

在 GitHub 仓库页面:
1. 点击 **Actions** 标签
2. 选择 **Apple System Status Monitor** 工作流
3. 点击右侧 **Run workflow** 按钮
4. 选择 **强制发送报告**: `true`(默认已选中)
5. 点击绿色的 **Run workflow** 按钮

这将立即运行一次监控,并**强制发送报告到企业微信**(即使所有服务正常)。你会收到一条健康报告,证明脚本正常工作。

### 方式 2: 每日健康报告

脚本会在**每天早上 9:00(北京时间)**自动发送一次健康报告,即使所有服务都正常运行。

报告内容包括:
- ✅ 服务总数
- ✅ 整体状态
- ✅ 检测时间

### 方式 3: 查看 Actions 日志

即使没有推送消息,你也可以通过查看 GitHub Actions 的运行日志来确认脚本是否正常执行:
1. 进入 **Actions** 标签
2. 点击最近的工作流运行记录
3. 查看详细日志,包括:
   - 获取到的服务数量
   - 每个服务的状态
   - 推送结果

## 📋 设置步骤

### 1. 安装依赖（本地测试用）

```bash
pnpm install
```

### 2. 配置 GitHub Secrets

1. 进入你的 GitHub 仓库
2. 点击 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**
4. 创建新的 Secret：
   - **Name**: `APPLE_WEBHOOK_URL`
   - **Value**: 填入你的企业微信 webhook URL（例：`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx`）

### 3. 推送代码到 GitHub

```bash
git add .
git commit -m "Add GitHub Actions monitoring"
git push origin main
```

### 4. 验证 Workflow

1. 进入 GitHub 仓库
2. 点击 **Actions** 标签
3. 找到 **Apple System Status Monitor** workflow
4. 可以点击 **Run workflow** 手动触发测试

## ⏱️ 执行时间表

当前配置每 5 分钟自动运行一次，全天 24 小时无间断监控。

## 🚨 告警逻辑

**触发推送的条件:**

1. **异常警报**: 只要检测到任何服务的状态不是 `light-available`(即非 operational 状态),就立即推送通知。
2. **健康报告**: 每天早上 9:00(北京时间)发送一次健康报告,即使所有服务正常。
3. **手动触发**: 通过 GitHub Actions 手动触发时,可选择是否强制发送报告。

检测的异常类型:
- **❌ 停机服务** (`light-unavailable` → down)
- **⚠️ 性能降级服务** (`light-resolved` → degraded)
- **❓ 未知状态服务** (其他状态 → unknown)

## 🔄 修改执行频率

编辑 `.github/workflows/apple-status-monitor.yml`：

```yaml
schedule:
  - cron: '0 */6 * * *'  # 每 6 小时执行一次
```

Cron 表达式格式：`分 小时 日 月 周`

### 常用示例：
- `0 * * * *` - 每小时
- `0 */6 * * *` - 每 6 小时
- `0 9 * * *` - 每天 9:00 UTC
- `0 9-18 * * 1-5` - 工作日 9:00-18:00 UTC 每小时

## 🧪 本地测试

```bash
export WEBHOOK_URL="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
pnpm run monitor
```

## 📊 执行日志

GitHub Actions 会记录每次执行的详细日志，包括：
- ✅ 获取的服务数量
- 📊 服务状态统计
- 🚨 检测到的异常服务
- 📧 推送结果

## ⚠️ 故障排查

### 1. Workflow 不执行
- 检查是否启用了 Actions：Settings → Actions → General
- 检查 Secrets 是否正确设置

### 2. 推送失败
- 检查 WEBHOOK_URL 是否正确
- 验证 webhook 地址是否有效
- 查看 Actions 日志中的具体错误信息

### 3. 浏览器启动失败
- GitHub Actions 已预装 Chromium，无需手动安装
- 如果仍有问题，workflow 会自动安装

## 💡 补充说明

- GitHub Actions 免费额度：每月 2000 分钟（对于本监控任务足够用）
- 脚本执行时间通常 2-3 分钟
- **健康报告**: 每天早上 9:00 自动发送一次，验证脚本正常运行
- **异常警报**: 检测到异常时立即发送企业微信通知
- 所有执行记录可在 Actions 标签页查看

## 📝 相关文件

- 监控脚本：`scripts/apple-status-monitor.ts`
- Workflow 配置：`.github/workflows/apple-status-monitor.yml`
- 本地运行：`pnpm run monitor`
