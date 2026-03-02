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

1. **差异通知 🔄**: 检测到服务状态发生变化时,立即推送差异通知。这是最优先的通知类型。
2. **异常警报 🚨**: 只要检测到任何服务的状态不是 `light-available`(即非 operational 状态),就立即推送通知。
3. **健康报告 ✅**: 每天早上 9:00(北京时间)发送一次健康报告,即使所有服务正常。
4. **手动触发**: 通过 GitHub Actions 手动触发时,可选择是否强制发送报告。

检测的异常类型:
- **❌ 停机服务** (`light-unavailable` → down)
- **⚠️ 性能降级服务** (`light-resolved` → degraded)
- **❓ 未知状态服务** (其他状态 → unknown)

### 差异检测功能

脚本会自动将每次爬取的数据与上一次的数据进行对比:
- 历史数据通过 Git 提交到仓库，实现真正的持久化
- GitHub Actions 自动提交 `data/apple.json` 的更新
- 每次运行时读取 Git 仓库中的历史数据进行对比
- 发现状态变化时立即发送差异通知
- 差异通知模板包含: 服务名称、旧状态 → 新状态
- 提交信息使用 `[skip ci]` 避免触发无限循环

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
- 数据存储：`data/apple.json` (通过 Git 提交实现持久化)
- 数据目录说明：`data/README.md`
- 差异检测测试：`DIFF_DETECTION_TEST.md`
- 本地运行：`pnpm run monitor`

## 🔧 Git 提交持久化说明

本项目使用 **Git 提交**来持久化历史数据:

### 工作原理

1. **读取数据**: 每次运行时从 Git 仓库读取 `data/apple.json`
2. **对比差异**: 与新爬取的数据进行对比
3. **保存数据**: 监控脚本更新 `apple.json` 文件
4. **自动提交**: GitHub Actions 自动提交更新到仓库

### 提交配置

```yaml
- name: 💾 提交历史数据变更
  run: |
    git config --local user.email "github-actions[bot]@users.noreply.github.com"
    git config --local user.name "github-actions[bot]"
    git add data/apple.json
    git commit -m "chore: 更新 Apple 服务状态数据 [skip ci]"
    git push
```

### 关键特性

- **自动提交**: 每次监控运行后自动提交数据更新
- **避免循环**: 使用 `[skip ci]` 标记，避免触发新的 workflow
- **Bot 身份**: 以 `github-actions[bot]` 身份提交
- **真正持久化**: 数据存储在 Git 历史中，永不丢失
- **版本追溯**: 可以通过 Git 历史查看任意时刻的服务状态

### 优势

相比 GitHub Actions Cache:
- ✅ **永久保存**: 不受 7 天限制
- ✅ **版本历史**: 可追溯任意历史状态
- ✅ **更可靠**: 不会因缓存过期而丢失数据
- ✅ **可视化**: 可在 GitHub 提交历史中查看更新
