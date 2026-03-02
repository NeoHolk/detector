import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// 加载 .env 文件(仅本地开发时使用)
dotenv.config();

interface Service {
  serviceName: string;
  status: 'operational' | 'degraded' | 'down' | 'unknown';
}

interface HistoryData {
  timestamp: string;
  services: Service[];
}

interface ServiceDiff {
  serviceName: string;
  oldStatus: 'operational' | 'degraded' | 'down' | 'unknown';
  newStatus: 'operational' | 'degraded' | 'down' | 'unknown';
}

async function fetchAppleStatus(): Promise<Service[]> {
  console.log('[监控脚本] 启动浏览器...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    console.log('[监控脚本] 访问 Apple 状态页面...');
    await page.goto('https://developer.apple.com/system-status/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    console.log('[监控脚本] 等待状态表格加载...');
    try {
      await page.waitForSelector('#ssp-lights-table', { timeout: 10000 });
    } catch (e) {
      console.warn('[监控脚本] 未找到状态表格，继续处理...');
    }

    await page.waitForTimeout(2000);

    console.log('[监控脚本] 提取服务数据...');
    const services = await page.evaluate(() => {
      const result: Service[] = [];
      const serviceWrappers = document.querySelectorAll('td.info-tooltip-wrapper');
      console.log(`[Evaluate] 找到 ${serviceWrappers.length} 个服务`);

      serviceWrappers.forEach((wrapper, index) => {
        try {
          const nameElement = wrapper.querySelector('div.light-content.light-name span[role="text"]');
          const serviceName = nameElement?.textContent?.trim() || '';
          const lightImageDiv = wrapper.querySelector('div.light-content.light-image > div');
          const statusClasses = lightImageDiv?.className || '';

          let status: 'operational' | 'degraded' | 'down' | 'unknown' = 'unknown';
          if (statusClasses.includes('light-available')) {
            status = 'operational';
          } else if (statusClasses.includes('light-resolved')) {
            status = 'degraded';
          } else if (statusClasses.includes('light-unavailable')) {
            status = 'down';
          }

          if (serviceName) {
            result.push({ serviceName, status });
            console.log(`[Evaluate] [${index + 1}] ${serviceName} - ${status}`);
          }
        } catch (e) {
          console.error(`[Evaluate] 处理服务 ${index} 时出错:`, e);
        }
      });

      return result;
    });

    console.log(`[监控脚本] ✅ 成功获取 ${services.length} 个服务状态`);
    return services;
  } finally {
    await browser.close();
    console.log('[监控脚本] 浏览器已关闭');
  }
}

// 读取历史数据
function readHistoryData(): HistoryData | null {
  const dataPath = path.join(process.cwd(), 'data', 'apple.json');
  try {
    if (fs.existsSync(dataPath)) {
      const content = fs.readFileSync(dataPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn('[存储] 读取历史数据失败:', error instanceof Error ? error.message : String(error));
  }
  return null;
}

// 保存当前数据
function saveHistoryData(services: Service[]): void {
  const dataPath = path.join(process.cwd(), 'data', 'apple.json');
  const data: HistoryData = {
    timestamp: new Date().toISOString(),
    services,
  };
  
  try {
    // 确保目录存在
    const dir = path.dirname(dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[存储] ✅ 数据已保存到 ${dataPath}`);
  } catch (error) {
    console.error('[存储] ❌ 保存数据失败:', error instanceof Error ? error.message : String(error));
  }
}

// 对比服务状态,找出差异
function diffServices(oldServices: Service[], newServices: Service[]): ServiceDiff[] {
  const diffs: ServiceDiff[] = [];
  
  // 创建旧服务的映射,便于查找
  const oldServicesMap = new Map<string, Service>();
  oldServices.forEach(s => oldServicesMap.set(s.serviceName, s));
  
  // 遍历新服务,找出状态变化
  newServices.forEach(newService => {
    const oldService = oldServicesMap.get(newService.serviceName);
    
    if (oldService && oldService.status !== newService.status) {
      diffs.push({
        serviceName: newService.serviceName,
        oldStatus: oldService.status,
        newStatus: newService.status,
      });
    }
  });
  
  return diffs;
}

// 发送差异通知
async function pushDiffNotification(webhookUrl: string, diffs: ServiceDiff[]): Promise<void> {
  console.log(`[推送] 🔄 检测到 ${diffs.length} 个服务状态变化，发送差异通知...`);
  
  let content = '# 🔄 Apple 服务状态变化通知\n\n';
  content += `**检测时间**: ${new Date().toLocaleString('zh-CN')}\n`;
  content += `**变化数量**: ${diffs.length} 个服务\n\n`;
  content += '---\n\n';
  
  diffs.forEach(diff => {
    const oldEmoji = getStatusEmoji(diff.oldStatus);
    const newEmoji = getStatusEmoji(diff.newStatus);
    const oldText = getStatusText(diff.oldStatus);
    const newText = getStatusText(diff.newStatus);
    
    content += `**${diff.serviceName}**\n`;
    content += `${oldEmoji} ${oldText} ➜ ${newEmoji} ${newText}\n\n`;
  });
  
  content += '---\n\n';
  content += '**数据来源**: https://developer.apple.com/system-status/\n';
  content += `*自动生成于 ${new Date().toLocaleString('zh-CN')}*`;
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown_v2',
        markdown_v2: { content },
      }),
    });
    
    const result = await response.json();
    if (response.ok && result.errcode === 0) {
      console.log('[推送] ✅ 差异通知推送成功');
    } else {
      console.error('[推送] ❌ 差异通知推送失败:', result.errmsg || '未知错误');
    }
  } catch (error) {
    console.error('[推送] ❌ 差异通知推送异常:', error instanceof Error ? error.message : String(error));
  }
}

// 获取状态对应的 emoji
function getStatusEmoji(status: string): string {
  switch (status) {
    case 'operational': return '✅';
    case 'degraded': return '⚠️';
    case 'down': return '❌';
    case 'unknown': return '❓';
    default: return '❓';
  }
}

// 获取状态对应的文本
function getStatusText(status: string): string {
  switch (status) {
    case 'operational': return '正常';
    case 'degraded': return '降级';
    case 'down': return '停机';
    case 'unknown': return '未知';
    default: return '未知';
  }
}

async function pushToWeChat(webhookUrl: string, services: Service[], forceReport: boolean = false): Promise<void> {
  if (!webhookUrl || !webhookUrl.trim()) {
    console.log('[推送] 未配置 webhook URL，跳过推送');
    return;
  }

  // 检测任何非 operational 的服务
  const abnormalServices = services.filter(s => s.status !== 'operational');

  // 检查是否需要发送每日健康报告(每天早上9点)
  const now = new Date();
  const hour = now.getUTCHours() + 8; // 转换为北京时间
  const adjustedHour = hour >= 24 ? hour - 24 : hour;
  const shouldSendDailyReport = forceReport || (adjustedHour === 9 && abnormalServices.length === 0);

  if (abnormalServices.length === 0 && !shouldSendDailyReport) {
    console.log('[推送] ✅ 所有服务正常，无需推送');
    return;
  }

  // 如果是健康报告
  if (abnormalServices.length === 0 && shouldSendDailyReport) {
    console.log('[推送] 📊 发送每日健康报告...');
    const content = `# ✅ Apple 服务健康报告\n\n` +
      `**检测时间**: ${new Date().toLocaleString('zh-CN')}\n\n` +
      `**服务总数**: ${services.length}\n` +
      `**状态**: 全部正常运行 🎉\n\n` +
      `---\n\n` +
      `**数据来源**: https://developer.apple.com/system-status/\n` +
      `*自动生成于 ${new Date().toLocaleString('zh-CN')}*`;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'markdown_v2',
          markdown_v2: { content },
        }),
      });

      const result = await response.json();
      if (response.ok && result.errcode === 0) {
        console.log('[推送] ✅ 健康报告推送成功');
      } else {
        console.error('[推送] ❌ 健康报告推送失败:', result.errmsg || '未知错误');
      }
    } catch (error) {
      console.error('[推送] ❌ 健康报告推送异常:', error instanceof Error ? error.message : String(error));
    }
    return;
  }

  console.log(`[推送] 🚨 检测到 ${abnormalServices.length} 个异常服务，开始推送...`);

  const downServices = abnormalServices.filter(s => s.status === 'down');
  const degradedServices = abnormalServices.filter(s => s.status === 'degraded');
  const unknownServices = abnormalServices.filter(s => s.status === 'unknown');

  let content = '# 🚨 Apple 服务异常警报\n\n';
  content += `**检测时间**: ${new Date().toLocaleString('zh-CN')}\n\n`;

  if (downServices.length > 0) {
    content += '## ❌ 停机服务\n';
    downServices.forEach(s => {
      content += `❌ ${s.serviceName}\n`;
    });
    content += '\n';
  }

  if (degradedServices.length > 0) {
    content += '## ⚠️ 性能降级服务\n';
    degradedServices.forEach(s => {
      content += `⚠️ ${s.serviceName}\n`;
    });
    content += '\n';
  }

  if (unknownServices.length > 0) {
    content += '## ❓ 未知状态服务\n';
    unknownServices.forEach(s => {
      content += `❓ ${s.serviceName}\n`;
    });
    content += '\n';
  }

  content += '---\n\n';
  content += '**数据来源**: https://developer.apple.com/system-status/\n';
  content += `*自动生成于 ${new Date().toLocaleString('zh-CN')}*`;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown_v2',
        markdown_v2: { content },
      }),
    });

    const result = await response.json();
    if (response.ok && result.errcode === 0) {
      console.log('[推送] ✅ 推送成功');
    } else {
      console.error('[推送] ❌ 推送失败:', result.errmsg || '未知错误');
    }
  } catch (error) {
    console.error('[推送] ❌ 推送异常:', error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  try {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) {
      console.error('❌ 错误: WEBHOOK_URL 环境变量未设置');
      process.exit(1);
    }

    console.log('========== Apple 系统状态监控 开始 ==========');
    console.log(`⏱️  执行时间: ${new Date().toLocaleString('zh-CN')}\n`);

    // 读取历史数据
    const historyData = readHistoryData();
    if (historyData) {
      console.log(`[存储] 📁 读取到历史数据 (${new Date(historyData.timestamp).toLocaleString('zh-CN')})`);
    } else {
      console.log('[存储] 📁 未找到历史数据，这是首次运行');
    }

    const services = await fetchAppleStatus();

    if (services.length === 0) {
      console.error('❌ 未获取到任何服务数据');
      process.exit(1);
    }

    const stats = {
      operational: services.filter(s => s.status === 'operational').length,
      degraded: services.filter(s => s.status === 'degraded').length,
      down: services.filter(s => s.status === 'down').length,
      unknown: services.filter(s => s.status === 'unknown').length,
    };

    console.log('\n[统计] 服务状态分布:');
    console.log(`  ✅ 正常: ${stats.operational}`);
    console.log(`  ⚠️ 降级: ${stats.degraded}`);
    console.log(`  ❌ 停机: ${stats.down}`);
    console.log(`  ❓ 未知: ${stats.unknown}\n`);

    // 对比历史数据,检测差异
    if (historyData && historyData.services) {
      const diffs = diffServices(historyData.services, services);
      
      if (diffs.length > 0) {
        console.log(`[对比] 🔍 检测到 ${diffs.length} 个服务状态变化`);
        diffs.forEach(diff => {
          console.log(`  - ${diff.serviceName}: ${diff.oldStatus} ➜ ${diff.newStatus}`);
        });
        
        // 发送差异通知
        await pushDiffNotification(webhookUrl, diffs);
      } else {
        console.log('[对比] ✅ 与上次检测相比，无服务状态变化');
      }
    }

    // 保存当前数据
    saveHistoryData(services);

    // 如果设置了 FORCE_REPORT=true，则强制发送报告
    const forceReport = process.env.FORCE_REPORT === 'true';
    await pushToWeChat(webhookUrl, services, forceReport);

    console.log('========== Apple 系统状态监控 结束 ==========');
  } catch (error) {
    console.error('❌ 脚本执行失败:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
