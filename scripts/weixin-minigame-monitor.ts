/**
 * 微信小游戏更新日志监控脚本
 * 使用工具类简化代码
 */

import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
import TurndownService from 'turndown';
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

interface ContentSnapshot {
  html: string;
  textContent: string;
  lastUpdated: string;
}

interface HistoryData {
  lastCheckTime: string;
  currentData: ContentSnapshot;
  changeHistory: { timestamp: string; changes: string }[];
}

// 获取微信小游戏更新日志内容
async function fetchWeixinContent(): Promise<ContentSnapshot> {
  logInfo('监控', '启动浏览器...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    logInfo('监控', '访问微信小游戏更新日志页面...');
    await page.goto('https://developers.weixin.qq.com/minigame/introduction/release.html', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    logInfo('监控', '等待内容区域加载...');
    try {
      await page.waitForSelector('#docContent > div.content.custom', { timeout: 10000 });
    } catch (e) {
      console.warn('[监控] 未找到目标元素，继续处理...');
    }

    await page.waitForTimeout(2000);

    logInfo('监控', '提取页面内容...');
    const snapshot = await page.evaluate(() => {
      const targetElement = document.querySelector('#docContent > div.content.custom');
      if (!targetElement) {
        return {
          html: '',
          textContent: '',
          lastUpdated: ''
        };
      }

      const html = targetElement.innerHTML;
      
      // 提取最新更新时间（从第一个月份标题）
      const firstMonthHeading = targetElement.querySelector('h2');
      const lastUpdated = firstMonthHeading?.textContent?.trim().replace(/^#+\s*/, '') || '';

      return {
        html,
        textContent: '',
        lastUpdated
      };
    });

    // 使用 turndown 将 HTML 转换为 Markdown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    
    // 自定义规则：移除内部链接
    turndownService.addRule('removeInternalLinks', {
      filter: (node) => {
        const isLink = node.nodeName === 'A';
        const hasHashHref = node.getAttribute('href')?.startsWith('#');
        return isLink && hasHashHref ? true : false;
      },
      replacement: (content) => content
    });
    
    snapshot.textContent = turndownService.turndown(snapshot.html);

    logSuccess('监控', `成功获取内容 (Markdown 长度: ${snapshot.textContent.length} 字符)`);
    logInfo('监控', `最新更新时间: ${snapshot.lastUpdated}`);
    return snapshot;
  } finally {
    await browser.close();
    logInfo('监控', '浏览器已关闭');
  }
}

// 检测内容变化
function detectChanges(oldSnapshot: ContentSnapshot, newSnapshot: ContentSnapshot): string {
  if (oldSnapshot.textContent === newSnapshot.textContent) {
    return '';
  }

  if (oldSnapshot.lastUpdated !== newSnapshot.lastUpdated) {
    return `检测到新版本更新: ${newSnapshot.lastUpdated}`;
  }

  return '检测到内容更新';
}

// 发送变化通知
async function pushChangeNotification(webhookUrls: string[], changes: string, newSnapshot: ContentSnapshot): Promise<void> {
  logInfo('推送', '检测到内容变化，发送通知...');
  
  const MAX_BYTES = 4096;
  
  const header = buildMessageHeader('🔄 微信小游戏更新日志变化通知', {
    '变化内容': changes,
    '最新更新': newSnapshot.lastUpdated,
  });
  
  const footer = buildMessageFooter('https://developers.weixin.qq.com/minigame/introduction/release.html');
  const truncationNotice = '\n\n*...(内容过长已截断，请查看原文获取完整信息)*';
  
  const headerBytes = getByteLength(header);
  const footerBytes = getByteLength(footer);
  const truncationBytes = getByteLength(truncationNotice);
  
  const availableBytes = MAX_BYTES - headerBytes - footerBytes - truncationBytes - 100;
  
  console.log(`[推送] 📏 头部: ${headerBytes}字节, 尾部: ${footerBytes}字节, 可用空间: ${availableBytes}字节`);
  
  // 智能提取内容
  const lines = newSnapshot.textContent.split('\n');
  let previewLines: string[] = [];
  let currentBytes = 0;
  let inContent = false;
  let truncated = false;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 跳过页面标题
    if (trimmedLine.startsWith('# #') || trimmedLine.includes('小游戏功能服务更新日志')) {
      inContent = true;
      continue;
    }
    
    if (!inContent) continue;
    
    const isHeading = line.match(/^##\s+/);
    let lineToAdd = line;
    
    // 对长行进行截断
    const lineBytes = getByteLength(line);
    if (!isHeading && lineBytes > 300) {
      let truncateLength = Math.floor(line.length * 300 / lineBytes) - 10;
      while (getByteLength(lineToAdd) > 300 && truncateLength > 0) {
        lineToAdd = line.substring(0, truncateLength) + '...';
        truncateLength -= 10;
      }
    }
    
    const lineByteLength = getByteLength(lineToAdd + '\n');
    if (currentBytes + lineByteLength > availableBytes) {
      truncated = true;
      break;
    }
    
    previewLines.push(lineToAdd);
    currentBytes += lineByteLength;
  }
  
  let previewContent = previewLines.join('\n');
  
  // 降级方案
  if (!previewContent.trim()) {
    let charCount = Math.floor(availableBytes / 3);
    previewContent = newSnapshot.textContent.substring(0, charCount);
    while (getByteLength(previewContent) > availableBytes) {
      charCount -= 10;
      previewContent = newSnapshot.textContent.substring(0, charCount);
    }
    truncated = true;
  }
  
  console.log(`[推送] 📊 预览内容: ${previewContent.length} 字符 / ${getByteLength(previewContent)} 字节`);
  
  let content = header + previewContent;
  if (truncated) {
    content += truncationNotice;
  }
  content += footer;
  
  // 最终安全检查
  if (getByteLength(content) > MAX_BYTES) {
    logInfo('推送', '内容仍然过长，进行强制截断...');
    let charCount = Math.floor(content.length * MAX_BYTES / getByteLength(content)) - 100;
    let safeContent = content.substring(0, charCount);
    while (getByteLength(safeContent + truncationNotice + footer) > MAX_BYTES && charCount > 0) {
      charCount -= 50;
      safeContent = content.substring(0, charCount);
    }
    content = safeContent + truncationNotice + footer;
  }
  
  await sendToMultipleWebhooks(webhookUrls, content, '变化通知');
}

// 发送每日健康报告
async function pushDailyReport(webhookUrls: string[], snapshot: ContentSnapshot): Promise<void> {
  logInfo('推送', '发送每日健康报告...');
  
  const content = buildMessageHeader('✅ 微信小游戏更新日志监控报告', {
    '最新更新': snapshot.lastUpdated,
    '内容长度': `${snapshot.textContent.length} 字符`,
    '状态': '正常监控中 🎉',
  }) + buildMessageFooter('https://developers.weixin.qq.com/minigame/introduction/release.html');

  await sendToMultipleWebhooks(webhookUrls, content, '健康报告');
}

async function main() {
  try {
    const webhookUrls = parseWebhookUrls();
    logMonitorStart('微信小游戏更新日志监控');

    const historyData = readHistoryData<ContentSnapshot>('weixin-minigame.json');
    if (historyData) {
      logInfo('存储', `读取到历史数据 (上次检查: ${formatLocalTime(new Date(historyData.lastCheckTime))})`);
      logInfo('存储', `历史变更记录: ${historyData.changeHistory.length} 条`);
    } else {
      logInfo('存储', '未找到历史数据，这是首次运行');
    }

    const snapshot = await fetchWeixinContent();

    if (!snapshot.html) {
      logError('监控', '未获取到任何内容');
      process.exit(1);
    }

    let changes = '';
    if (historyData && historyData.currentData) {
      changes = detectChanges(historyData.currentData, snapshot);
      
      if (changes) {
        logInfo('对比', `检测到内容变化: ${changes}`);
        await pushChangeNotification(webhookUrls, changes, snapshot);
        saveHistoryData('weixin-minigame.json', snapshot, changes);
      } else {
        logInfo('对比', '与上次检测相比，内容无变化');
      }
    } else {
      logInfo('存储', '首次运行，保存初始数据');
      saveHistoryData('weixin-minigame.json', snapshot);
    }

    // 检查是否需要发送每日健康报告
    const forceReport = process.env.FORCE_REPORT === 'true';
    if (shouldSendDailyReport(9, forceReport, !!changes)) {
      await pushDailyReport(webhookUrls, snapshot);
    }

    logMonitorEnd('微信小游戏更新日志监控');
  } catch (error) {
    logError('脚本', `执行失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
