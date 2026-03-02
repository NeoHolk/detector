/**
 * 监控脚本模板
 * 快速创建新的监控脚本
 * 
 * 使用说明:
 * 1. 复制此文件并重命名(如 github-monitor.ts)
 * 2. 修改接口定义(DataType, HistoryData)
 * 3. 实现 fetchData() 函数
 * 4. 实现 detectChanges() 函数
 * 5. 根据需要调整推送消息内容
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

// ============ 1. 定义数据结构 ============

/**
 * 监控的数据类型
 * 根据实际监控目标修改
 */
interface DataType {
  // 示例字段
  name: string;
  status: 'operational' | 'degraded' | 'down' | 'unknown';
  // 添加更多字段...
}

/**
 * 变化记录类型
 */
interface ChangeRecord {
  // 示例字段
  name: string;
  oldStatus: string;
  newStatus: string;
  // 添加更多字段...
}

/**
 * 历史数据结构
 */
interface HistoryData {
  lastCheckTime: string;
  currentData: DataType[];
  changeHistory: { timestamp: string; changes: ChangeRecord[] }[];
}

// ============ 2. 实现数据获取逻辑 ============

/**
 * 获取监控数据
 * 这里实现具体的数据抓取逻辑
 */
async function fetchData(): Promise<DataType[]> {
  logInfo('监控', '启动浏览器...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // 修改为实际的监控目标 URL
    const targetUrl = 'https://example.com/status';
    logInfo('监控', `访问页面: ${targetUrl}`);
    
    await page.goto(targetUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // 可选:等待特定元素加载
    try {
      await page.waitForSelector('.status-container', { timeout: 10000 });
    } catch (e) {
      console.warn('[监控] 未找到目标元素，继续处理...');
    }

    await page.waitForTimeout(2000);

    logInfo('监控', '提取数据...');
    
    // TODO: 实现具体的数据提取逻辑
    const data = await page.evaluate(() => {
      const result: DataType[] = [];
      
      // 示例: 提取页面元素
      const elements = document.querySelectorAll('.status-item');
      elements.forEach((element) => {
        const name = element.querySelector('.name')?.textContent?.trim() || '';
        const statusText = element.querySelector('.status')?.textContent?.trim() || '';
        
        let status: 'operational' | 'degraded' | 'down' | 'unknown' = 'unknown';
        // 根据实际情况判断状态
        if (statusText.includes('正常')) status = 'operational';
        else if (statusText.includes('降级')) status = 'degraded';
        else if (statusText.includes('停机')) status = 'down';
        
        if (name) {
          result.push({ name, status });
        }
      });
      
      return result;
    });

    logSuccess('监控', `成功获取 ${data.length} 条数据`);
    return data;
  } finally {
    await browser.close();
    logInfo('监控', '浏览器已关闭');
  }
}

// ============ 3. 实现变化检测逻辑 ============

/**
 * 检测数据变化
 */
function detectChanges(oldData: DataType[], newData: DataType[]): ChangeRecord[] {
  const changes: ChangeRecord[] = [];
  
  // 创建旧数据映射
  const oldDataMap = new Map<string, DataType>();
  oldData.forEach(item => oldDataMap.set(item.name, item));
  
  // 检测变化
  newData.forEach(newItem => {
    const oldItem = oldDataMap.get(newItem.name);
    
    if (oldItem && oldItem.status !== newItem.status) {
      changes.push({
        name: newItem.name,
        oldStatus: oldItem.status,
        newStatus: newItem.status,
      });
    }
  });
  
  return changes;
}

// ============ 4. 实现推送逻辑 ============

/**
 * 发送变化通知
 */
async function pushChangeNotification(webhookUrls: string[], changes: ChangeRecord[]): Promise<void> {
  logInfo('推送', `检测到 ${changes.length} 个变化，发送通知...`);

  const header = buildMessageHeader('🔄 监控变化通知', {
    '变化数量': `${changes.length} 项`,
  });

  let body = '';
  changes.forEach(change => {
    body += `**${change.name}**\n`;
    body += `${change.oldStatus} ➜ ${change.newStatus}\n\n`;
  });

  // 修改为实际的数据来源 URL
  const footer = buildMessageFooter('https://example.com/status');
  let content = header + body + footer;

  // 检查并截断内容(企业微信限制 4096 字节)
  const MAX_BYTES = 4096;
  if (getByteLength(content) > MAX_BYTES) {
    logInfo('推送', '内容过长，进行截断...');
    const truncationNotice = '\n\n*...(内容过长已截断)*';
    const availableBytes = MAX_BYTES - getByteLength(header + footer + truncationNotice);
    
    let truncatedBody = '';
    let currentBytes = 0;
    for (const change of changes) {
      const line = `**${change.name}**\n${change.oldStatus} ➜ ${change.newStatus}\n\n`;
      const lineBytes = getByteLength(line);
      if (currentBytes + lineBytes > availableBytes) break;
      truncatedBody += line;
      currentBytes += lineBytes;
    }
    
    content = header + truncatedBody + truncationNotice + footer;
  }

  await sendToMultipleWebhooks(webhookUrls, content, '变化通知');
}

/**
 * 发送每日健康报告
 */
async function pushDailyReport(webhookUrls: string[], data: DataType[]): Promise<void> {
  logInfo('推送', '发送每日健康报告...');

  const normalCount = data.filter(item => item.status === 'operational').length;
  const abnormalCount = data.length - normalCount;

  const header = buildMessageHeader('✅ 监控健康报告', {
    '数据总数': `${data.length}`,
    '正常数量': `${normalCount}`,
    '异常数量': `${abnormalCount}`,
  });

  let body = '';
  if (abnormalCount > 0) {
    body += '## ⚠️ 异常项目\n';
    data.filter(item => item.status !== 'operational').forEach(item => {
      body += `- ${item.name}: ${item.status}\n`;
    });
    body += '\n';
  } else {
    body += '**状态**: 全部正常运行 🎉\n\n';
  }

  const footer = buildMessageFooter('https://example.com/status');
  const content = header + body + footer;

  await sendToMultipleWebhooks(webhookUrls, content, '健康报告');
}

// ============ 5. 主函数 ============

async function main() {
  try {
    const webhookUrls = parseWebhookUrls();
    
    // 修改为实际的监控名称
    logMonitorStart('示例监控');

    // 读取历史数据
    const historyData = readHistoryData<DataType[]>('example.json'); // 修改文件名
    if (historyData) {
      logInfo('存储', `读取到历史数据 (上次检查: ${formatLocalTime(new Date(historyData.lastCheckTime))})`);
      logInfo('存储', `历史变更记录: ${historyData.changeHistory.length} 条`);
    } else {
      logInfo('存储', '未找到历史数据，这是首次运行');
    }

    // 获取当前数据
    const currentData = await fetchData();

    if (currentData.length === 0) {
      logError('监控', '未获取到任何数据');
      process.exit(1);
    }

    // 输出统计信息
    const stats = {
      '✅ 正常': currentData.filter(item => item.status === 'operational').length,
      '⚠️ 异常': currentData.filter(item => item.status !== 'operational').length,
    };
    console.log('\n[统计] 数据分布:');
    Object.entries(stats).forEach(([key, value]) => console.log(`  ${key}: ${value}`));
    console.log();

    // 检测变化
    let changes: ChangeRecord[] = [];
    if (historyData && historyData.currentData && historyData.currentData.length > 0) {
      changes = detectChanges(historyData.currentData, currentData);
      
      if (changes.length > 0) {
        logInfo('对比', `检测到 ${changes.length} 个变化`);
        changes.forEach(change => {
          console.log(`  - ${change.name}: ${change.oldStatus} ➜ ${change.newStatus}`);
        });
        
        // 发送变化通知
        await pushChangeNotification(webhookUrls, changes);
        
        // 保存历史数据
        saveHistoryData('example.json', currentData, changes); // 修改文件名
      } else {
        logInfo('对比', '与上次检测相比，无数据变化');
      }
    } else {
      logInfo('存储', '首次运行，保存初始数据');
      saveHistoryData('example.json', currentData); // 修改文件名
    }

    // 检查是否需要发送每日报告
    const forceReport = process.env.FORCE_REPORT === 'true';
    if (shouldSendDailyReport(9, forceReport, changes.length > 0)) {
      await pushDailyReport(webhookUrls, currentData);
    }

    logMonitorEnd('示例监控'); // 修改监控名称
  } catch (error) {
    logError('脚本', `执行失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
