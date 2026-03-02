/**
 * Apple 系统状态监控脚本
 * 使用工具类简化代码
 */

import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
import {
  parseWebhookUrls,
  sendToMultipleWebhooks,
  buildMessageHeader,
  buildMessageFooter,
  readHistoryData,
  saveHistoryData,
  shouldSendDailyReport,
  formatLocalTime,
  logMonitorStart,
  logMonitorEnd,
  logInfo,
  logError,
  logSuccess,
  getByteLength,
} from './utils';

dotenv.config();

interface Service {
  serviceName: string;
  status: 'operational' | 'degraded' | 'down' | 'unknown';
}

interface ServiceDiff {
  serviceName: string;
  oldStatus: 'operational' | 'degraded' | 'down' | 'unknown';
  newStatus: 'operational' | 'degraded' | 'down' | 'unknown';
}

interface HistoryData {
  lastCheckTime: string;
  currentData: Service[];
  changeHistory: { timestamp: string; changes: ServiceDiff[] }[];
}

// 获取 Apple 服务状态
async function fetchAppleStatus(): Promise<Service[]> {
  logInfo('监控', '启动浏览器...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    logInfo('监控', '访问 Apple 状态页面...');
    await page.goto('https://developer.apple.com/system-status/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    logInfo('监控', '等待状态表格加载...');
    try {
      await page.waitForSelector('#ssp-lights-table', { timeout: 10000 });
    } catch (e) {
      console.warn('[监控] 未找到状态表格，继续处理...');
    }

    await page.waitForTimeout(2000);

    logInfo('监控', '提取服务数据...');
    const services = await page.evaluate(() => {
      const result: Service[] = [];
      const serviceWrappers = document.querySelectorAll('td.info-tooltip-wrapper');

      serviceWrappers.forEach((wrapper) => {
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
          }
        } catch (e) {
          console.error('[监控] 处理服务时出错:', e);
        }
      });

      return result;
    });

    logSuccess('监控', `成功获取 ${services.length} 个服务状态`);
    return services;
  } finally {
    await browser.close();
    logInfo('监控', '浏览器已关闭');
  }
}

// 对比服务状态差异
function diffServices(oldServices: Service[], newServices: Service[]): ServiceDiff[] {
  const diffs: ServiceDiff[] = [];
  const oldServicesMap = new Map<string, Service>();
  oldServices.forEach(s => oldServicesMap.set(s.serviceName, s));

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

// 获取状态 emoji
function getStatusEmoji(status: string): string {
  const emojiMap: Record<string, string> = {
    operational: '✅',
    degraded: '⚠️',
    down: '❌',
    unknown: '❓',
  };
  return emojiMap[status] || '❓';
}

// 获取状态文本
function getStatusText(status: string): string {
  const textMap: Record<string, string> = {
    operational: '正常',
    degraded: '降级',
    down: '停机',
    unknown: '未知',
  };
  return textMap[status] || '未知';
}

// 发送差异通知
async function pushDiffNotification(webhookUrls: string[], diffs: ServiceDiff[]): Promise<void> {
  logInfo('推送', `检测到 ${diffs.length} 个服务状态变化，发送差异通知...`);

  const header = buildMessageHeader('🔄 Apple 服务状态变化通知', {
    '变化数量': `${diffs.length} 个服务`,
  });

  let body = '';
  diffs.forEach(diff => {
    const oldEmoji = getStatusEmoji(diff.oldStatus);
    const newEmoji = getStatusEmoji(diff.newStatus);
    const oldText = getStatusText(diff.oldStatus);
    const newText = getStatusText(diff.newStatus);

    body += `**${diff.serviceName}**\n`;
    body += `${oldEmoji} ${oldText} ➜ ${newEmoji} ${newText}\n\n`;
  });

  const footer = buildMessageFooter('https://developer.apple.com/system-status/');
  let content = header + body + footer;

  // 检查并截断内容
  const MAX_BYTES = 4096;
  if (getByteLength(content) > MAX_BYTES) {
    logInfo('推送', '内容过长，进行截断...');
    const truncationNotice = '\n\n*...(内容过长已截断)*';
    const availableBytes = MAX_BYTES - getByteLength(header + footer + truncationNotice);
    
    let truncatedBody = '';
    let currentBytes = 0;
    for (const diff of diffs) {
      const line = `**${diff.serviceName}**\n${getStatusEmoji(diff.oldStatus)} ${getStatusText(diff.oldStatus)} ➜ ${getStatusEmoji(diff.newStatus)} ${getStatusText(diff.newStatus)}\n\n`;
      const lineBytes = getByteLength(line);
      if (currentBytes + lineBytes > availableBytes) break;
      truncatedBody += line;
      currentBytes += lineBytes;
    }
    
    content = header + truncatedBody + truncationNotice + footer;
  }

  await sendToMultipleWebhooks(webhookUrls, content, '差异通知');
}

// 发送健康报告或异常警报
async function pushStatusReport(webhookUrls: string[], services: Service[], forceReport: boolean): Promise<void> {
  const abnormalServices = services.filter(s => s.status !== 'operational');
  const shouldSend = shouldSendDailyReport(9, forceReport, false);

  if (abnormalServices.length === 0 && !shouldSend) {
    logInfo('推送', '所有服务正常，无需推送');
    return;
  }

  // 健康报告
  if (abnormalServices.length === 0) {
    logInfo('推送', '发送每日健康报告...');
    const content = buildMessageHeader('✅ Apple 服务健康报告', {
      '服务总数': `${services.length}`,
      '状态': '全部正常运行 🎉',
    }) + buildMessageFooter('https://developer.apple.com/system-status/');

    await sendToMultipleWebhooks(webhookUrls, content, '健康报告');
    return;
  }

  // 异常警报
  logInfo('推送', `检测到 ${abnormalServices.length} 个异常服务，发送警报...`);
  
  const downServices = abnormalServices.filter(s => s.status === 'down');
  const degradedServices = abnormalServices.filter(s => s.status === 'degraded');
  const unknownServices = abnormalServices.filter(s => s.status === 'unknown');

  let body = '';
  if (downServices.length > 0) {
    body += '## ❌ 停机服务\n';
    downServices.forEach(s => body += `❌ ${s.serviceName}\n`);
    body += '\n';
  }
  if (degradedServices.length > 0) {
    body += '## ⚠️ 性能降级服务\n';
    degradedServices.forEach(s => body += `⚠️ ${s.serviceName}\n`);
    body += '\n';
  }
  if (unknownServices.length > 0) {
    body += '## ❓ 未知状态服务\n';
    unknownServices.forEach(s => body += `❓ ${s.serviceName}\n`);
    body += '\n';
  }

  const content = buildMessageHeader('🚨 Apple 服务异常警报') + 
                  body + 
                  buildMessageFooter('https://developer.apple.com/system-status/');

  await sendToMultipleWebhooks(webhookUrls, content, '异常警报');
}

async function main() {
  try {
    const webhookUrls = parseWebhookUrls();
    logMonitorStart('Apple 系统状态监控');

    // 读取历史数据
    const historyData = readHistoryData<Service[]>('apple.json');
    if (historyData) {
      logInfo('存储', `读取到历史数据 (上次检查: ${formatLocalTime(new Date(historyData.lastCheckTime))})`);
    } else {
      logInfo('存储', '未找到历史数据，这是首次运行');
    }

    const services = await fetchAppleStatus();

    if (services.length === 0) {
      logError('监控', '未获取到任何服务数据');
      process.exit(1);
    }

    const stats = {
      '✅ 正常': services.filter(s => s.status === 'operational').length,
      '⚠️ 降级': services.filter(s => s.status === 'degraded').length,
      '❌ 停机': services.filter(s => s.status === 'down').length,
      '❓ 未知': services.filter(s => s.status === 'unknown').length,
    };

    console.log('\n[统计] 服务状态分布:');
    Object.entries(stats).forEach(([key, value]) => console.log(`  ${key}: ${value}`));
    console.log();

    // 对比差异
    let diffs: ServiceDiff[] = [];
    if (historyData && historyData.currentData && historyData.currentData.length > 0) {
      diffs = diffServices(historyData.currentData, services);
      
      if (diffs.length > 0) {
        logInfo('对比', `检测到 ${diffs.length} 个服务状态变化`);
        diffs.forEach(diff => console.log(`  - ${diff.serviceName}: ${diff.oldStatus} ➜ ${diff.newStatus}`));
        
        await pushDiffNotification(webhookUrls, diffs);
        saveHistoryData('apple.json', services, diffs);
      } else {
        logInfo('对比', '与上次检测相比，无服务状态变化');
      }
    } else {
      logInfo('存储', '首次运行，保存初始数据');
      saveHistoryData('apple.json', services);
    }

    // 发送报告
    const forceReport = process.env.FORCE_REPORT === 'true';
    await pushStatusReport(webhookUrls, services, forceReport);

    logMonitorEnd('Apple 系统状态监控');
  } catch (error) {
    logError('脚本', `执行失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
