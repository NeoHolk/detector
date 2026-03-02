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

interface ChangeRecord {
  timestamp: string;
  changes: ServiceDiff[];
}

interface HistoryData {
  lastCheckTime: string;
  currentServices: Service[];
  changeHistory: ChangeRecord[];
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
      const data = JSON.parse(content);
      
      // 兼容旧格式
      if (data.timestamp && data.services && !data.lastCheckTime) {
        return {
          lastCheckTime: data.timestamp,
          currentServices: data.services,
          changeHistory: []
        };
      }
      
      return data;
    }
  } catch (error) {
    console.warn('[存储] 读取历史数据失败:', error instanceof Error ? error.message : String(error));
  }
  return null;
}

// 保存当前数据（只在有差异时调用）
function saveHistoryData(services: Service[], diffs: ServiceDiff[]): void {
  const dataPath = path.join(process.cwd(), 'data', 'apple.json');
  const now = new Date().toISOString();
  
  try {
    // 读取现有数据
    let historyData: HistoryData = {
      lastCheckTime: now,
      currentServices: services,
      changeHistory: []
    };
    
    if (fs.existsSync(dataPath)) {
      const existingData = readHistoryData();
      if (existingData) {
        historyData.changeHistory = existingData.changeHistory || [];
      }
    }
    
    // 只有当有差异时才添加变更记录
    if (diffs.length > 0) {
      historyData.changeHistory.push({
        timestamp: now,
        changes: diffs
      });
      
      // 限制历史记录数量，避免文件过大（保留最近100条变更记录）
      if (historyData.changeHistory.length > 100) {
        historyData.changeHistory = historyData.changeHistory.slice(-100);
      }
    }
    
    // 更新当前状态和检查时间
    historyData.lastCheckTime = now;
    historyData.currentServices = services;
    
    // 确保目录存在
    const dir = path.dirname(dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(dataPath, JSON.stringify(historyData, null, 2), 'utf-8');
    console.log(`[存储] ✅ 数据已保存到 ${dataPath}`);
    if (diffs.length > 0) {
      console.log(`[存储] 📝 新增变更记录: ${diffs.length} 个服务状态变化`);
    }
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
  
  // 企业微信 markdown_v2 内容限制为 4096 字节
  const MAX_BYTES = 4096;
  
  const now = new Date().toLocaleString('zh-CN');
  let content = '# 🔄 Apple 服务状态变化通知\n\n';
  content += `**检测时间**: ${now}\n`;
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
  content += `*自动生成于 ${now}*`;
  
  // 检查字节长度
  const contentBytes = Buffer.byteLength(content, 'utf8');
  console.log(`[推送] 📊 通知内容: ${content.length} 字符 / ${contentBytes} 字节`);
  
  // 如果超过限制，进行截断
  if (contentBytes > MAX_BYTES) {
    console.log(`[推送] ⚠️ 内容超过 ${MAX_BYTES} 字节限制，进行截断...`);
    const footer = '\n\n---\n\n**数据来源**: https://developer.apple.com/system-status/\n' + `*自动生成于 ${now}*`;
    const truncationNotice = '\n\n*...(内容过长已截断)*';
    const header = content.substring(0, content.indexOf('---\n\n') + 6);
    
    // 计算可用空间
    const availableBytes = MAX_BYTES - Buffer.byteLength(header + footer + truncationNotice, 'utf8');
    
    // 逐个添加变化项，直到超出限制
    let diffContent = '';
    let diffBytes = 0;
    for (const diff of diffs) {
      const oldEmoji = getStatusEmoji(diff.oldStatus);
      const newEmoji = getStatusEmoji(diff.newStatus);
      const oldText = getStatusText(diff.oldStatus);
      const newText = getStatusText(diff.newStatus);
      const diffLine = `**${diff.serviceName}**\n${oldEmoji} ${oldText} ➜ ${newEmoji} ${newText}\n\n`;
      const lineBytes = Buffer.byteLength(diffLine, 'utf8');
      
      if (diffBytes + lineBytes > availableBytes) break;
      
      diffContent += diffLine;
      diffBytes += lineBytes;
    }
    
    content = header + diffContent + truncationNotice + footer;
    const finalBytes = Buffer.byteLength(content, 'utf8');
    console.log(`[推送] 📊 截断后: ${content.length} 字符 / ${finalBytes} 字节`);
  }
  
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

  // 企业微信 markdown_v2 内容限制为 4096 字节
  const MAX_BYTES = 4096;
  
  const downServices = abnormalServices.filter(s => s.status === 'down');
  const degradedServices = abnormalServices.filter(s => s.status === 'degraded');
  const unknownServices = abnormalServices.filter(s => s.status === 'unknown');

  const nowStr = now.toLocaleString('zh-CN');
  let content = '# 🚨 Apple 服务异常警报\n\n';
  content += `**检测时间**: ${nowStr}\n\n`;

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
  content += `*自动生成于 ${nowStr}*`;

  // 检查字节长度
  const contentBytes = Buffer.byteLength(content, 'utf8');
  console.log(`[推送] 📊 通知内容: ${content.length} 字符 / ${contentBytes} 字节`);
  
  // 如果超过限制，进行截断
  if (contentBytes > MAX_BYTES) {
    console.log(`[推送] ⚠️ 内容超过 ${MAX_BYTES} 字节限制，进行截断...`);
    const footer = '\n\n---\n\n**数据来源**: https://developer.apple.com/system-status/\n' + `*自动生成于 ${nowStr}*`;
    const truncationNotice = '\n\n*...(内容过长已截断)*';
    const header = `# 🚨 Apple 服务异常警报\n\n**检测时间**: ${nowStr}\n\n`;
    
    // 计算可用空间
    const availableBytes = MAX_BYTES - Buffer.byteLength(header + footer + truncationNotice, 'utf8');
    
    // 重新构建内容，按优先级添加
    let serviceContent = '';
    let serviceBytes = 0;
    
    // 优先添加停机服务
    if (downServices.length > 0) {
      const section = '## ❌ 停机服务\n';
      const sectionBytes = Buffer.byteLength(section, 'utf8');
      if (serviceBytes + sectionBytes < availableBytes) {
        serviceContent += section;
        serviceBytes += sectionBytes;
        
        for (const s of downServices) {
          const line = `❌ ${s.serviceName}\n`;
          const lineBytes = Buffer.byteLength(line, 'utf8');
          if (serviceBytes + lineBytes > availableBytes) break;
          serviceContent += line;
          serviceBytes += lineBytes;
        }
        serviceContent += '\n';
        serviceBytes += 1;
      }
    }
    
    // 然后添加降级服务
    if (degradedServices.length > 0 && serviceBytes < availableBytes) {
      const section = '## ⚠️ 性能降级服务\n';
      const sectionBytes = Buffer.byteLength(section, 'utf8');
      if (serviceBytes + sectionBytes < availableBytes) {
        serviceContent += section;
        serviceBytes += sectionBytes;
        
        for (const s of degradedServices) {
          const line = `⚠️ ${s.serviceName}\n`;
          const lineBytes = Buffer.byteLength(line, 'utf8');
          if (serviceBytes + lineBytes > availableBytes) break;
          serviceContent += line;
          serviceBytes += lineBytes;
        }
        serviceContent += '\n';
        serviceBytes += 1;
      }
    }
    
    // 最后添加未知状态服务
    if (unknownServices.length > 0 && serviceBytes < availableBytes) {
      const section = '## ❓ 未知状态服务\n';
      const sectionBytes = Buffer.byteLength(section, 'utf8');
      if (serviceBytes + sectionBytes < availableBytes) {
        serviceContent += section;
        serviceBytes += sectionBytes;
        
        for (const s of unknownServices) {
          const line = `❓ ${s.serviceName}\n`;
          const lineBytes = Buffer.byteLength(line, 'utf8');
          if (serviceBytes + lineBytes > availableBytes) break;
          serviceContent += line;
          serviceBytes += lineBytes;
        }
      }
    }
    
    content = header + serviceContent + truncationNotice + footer;
    const finalBytes = Buffer.byteLength(content, 'utf8');
    console.log(`[推送] 📊 截断后: ${content.length} 字符 / ${finalBytes} 字节`);
  }

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
      console.log(`[存储] 📁 读取到历史数据 (上次检查: ${new Date(historyData.lastCheckTime).toLocaleString('zh-CN')})`);
      console.log(`[存储] 📊 历史变更记录: ${historyData.changeHistory.length} 条`);
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
    let diffs: ServiceDiff[] = [];
    if (historyData && historyData.currentServices) {
      // 如果历史数据的服务列表为空，说明是首次有数据，需要保存
      if (historyData.currentServices.length === 0 && services.length > 0) {
        console.log('[存储] 📝 检测到首次有效数据，保存初始状态');
        saveHistoryData(services, []);
      } else {
        // 正常对比差异
        diffs = diffServices(historyData.currentServices, services);
        
        if (diffs.length > 0) {
          console.log(`[对比] 🔍 检测到 ${diffs.length} 个服务状态变化`);
          diffs.forEach(diff => {
            console.log(`  - ${diff.serviceName}: ${diff.oldStatus} ➜ ${diff.newStatus}`);
          });
          
          // 发送差异通知
          await pushDiffNotification(webhookUrl, diffs);
          
          // 只在有差异时保存数据
          saveHistoryData(services, diffs);
        } else {
          console.log('[对比] ✅ 与上次检测相比，无服务状态变化');
          console.log('[存储] ⏭️ 数据无变化，跳过保存和提交');
        }
      }
    } else {
      // 首次运行，保存初始数据
      console.log('[存储] 📝 首次运行，保存初始数据');
      saveHistoryData(services, []);
    }

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
