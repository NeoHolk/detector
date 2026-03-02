import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import TurndownService from 'turndown';

dotenv.config();

interface ContentSnapshot {
  html: string;
  textContent: string;
  lastUpdated: string;
}

interface ChangeRecord {
  timestamp: string;
  changes: string;
}

interface HistoryData {
  lastCheckTime: string;
  currentSnapshot: ContentSnapshot;
  changeHistory: ChangeRecord[];
}

async function fetchWeixinContent(): Promise<ContentSnapshot> {
  console.log('[监控脚本] 启动浏览器...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    console.log('[监控脚本] 访问微信小游戏更新日志页面...');
    await page.goto('https://developers.weixin.qq.com/minigame/introduction/release.html', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    console.log('[监控脚本] 等待内容区域加载...');
    try {
      await page.waitForSelector('#docContent > div.content.custom', { timeout: 10000 });
    } catch (e) {
      console.warn('[监控脚本] 未找到目标元素，继续处理...');
    }

    await page.waitForTimeout(2000);

    console.log('[监控脚本] 提取页面内容...');
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
      
      // 尝试提取最新更新时间（从第一个月份标题）
      const firstMonthHeading = targetElement.querySelector('h2');
      const lastUpdated = firstMonthHeading?.textContent?.trim().replace(/^#+\s*/, '') || '';

      return {
        html,
        textContent: '', // 先留空，后面用 turndown 转换
        lastUpdated
      };
    });

    // 使用 turndown 将 HTML 转换为 Markdown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    
    // 自定义规则：移除内部链接和不必要的元素
    turndownService.addRule('removeInternalLinks', {
      filter: (node) => {
        const isLink = node.nodeName === 'A';
        const hasHashHref = node.getAttribute('href')?.startsWith('#');
        return isLink && hasHashHref ? true : false;
      },
      replacement: (content) => content
    });
    
    snapshot.textContent = turndownService.turndown(snapshot.html);

    console.log(`[监控脚本] ✅ 成功获取内容 (Markdown 长度: ${snapshot.textContent.length} 字符)`);
    console.log(`[监控脚本] 📅 最新更新时间: ${snapshot.lastUpdated}`);
    return snapshot;
  } finally {
    await browser.close();
    console.log('[监控脚本] 浏览器已关闭');
  }
}

function readHistoryData(): HistoryData | null {
  const dataPath = path.join(process.cwd(), 'data', 'weixin-minigame.json');
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

function saveHistoryData(snapshot: ContentSnapshot, changes: string): void {
  const dataPath = path.join(process.cwd(), 'data', 'weixin-minigame.json');
  const now = new Date().toISOString();
  
  try {
    let historyData: HistoryData = {
      lastCheckTime: now,
      currentSnapshot: snapshot,
      changeHistory: []
    };
    
    if (fs.existsSync(dataPath)) {
      const existingData = readHistoryData();
      if (existingData) {
        historyData.changeHistory = existingData.changeHistory || [];
      }
    }
    
    if (changes) {
      historyData.changeHistory.push({
        timestamp: now,
        changes
      });
      
      if (historyData.changeHistory.length > 50) {
        historyData.changeHistory = historyData.changeHistory.slice(-50);
      }
    }
    
    historyData.lastCheckTime = now;
    historyData.currentSnapshot = snapshot;
    
    const dir = path.dirname(dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(dataPath, JSON.stringify(historyData, null, 2), 'utf-8');
    console.log(`[存储] ✅ 数据已保存到 ${dataPath}`);
    if (changes) {
      console.log(`[存储] 📝 新增变更记录`);
    }
  } catch (error) {
    console.error('[存储] ❌ 保存数据失败:', error instanceof Error ? error.message : String(error));
  }
}

function detectChanges(oldSnapshot: ContentSnapshot, newSnapshot: ContentSnapshot): string {
  // 比较文本内容
  if (oldSnapshot.textContent === newSnapshot.textContent) {
    return '';
  }

  // 提取新增的内容（简单策略：检测最新月份是否改变）
  if (oldSnapshot.lastUpdated !== newSnapshot.lastUpdated) {
    return `检测到新版本更新: ${newSnapshot.lastUpdated}`;
  }

  // 如果内容有变化但月份没变，说明是同月内的更新
  return '检测到内容更新';
}

async function pushChangeNotification(webhookUrl: string, changes: string, newSnapshot: ContentSnapshot): Promise<void> {
  console.log(`[推送] 🔄 检测到内容变化，发送通知...`);
  
  // 企业微信 markdown_v2 内容限制为 4096 **字节**（不是字符！）
  const MAX_BYTES = 4096;
  
  // 构建固定的头部和尾部
  const now = new Date().toLocaleString('zh-CN');
  const header = '# 🔄 微信小游戏更新日志变化通知\n\n' +
    `**检测时间**: ${now}\n` +
    `**变化内容**: ${changes}\n` +
    `**最新更新**: ${newSnapshot.lastUpdated}\n\n` +
    '---\n\n';
  
  const footer = '\n\n---\n\n' +
    '**数据来源**: https://developers.weixin.qq.com/minigame/introduction/release.html\n' +
    `*自动生成于 ${now}*`;
  
  const truncationNotice = '\n\n*...(内容过长已截断，请查看原文获取完整信息)*';
  
  const headerBytes = Buffer.byteLength(header, 'utf8');
  const footerBytes = Buffer.byteLength(footer, 'utf8');
  const truncationBytes = Buffer.byteLength(truncationNotice, 'utf8');
  
  // 计算可用于内容的字节数
  const availableBytes = MAX_BYTES - headerBytes - footerBytes - truncationBytes - 100; // 100字节安全buffer
  
  console.log(`[推送] 📏 头部: ${headerBytes}字节, 尾部: ${footerBytes}字节, 截断提示: ${truncationBytes}字节`);
  console.log(`[推送] 📏 可用空间: ${availableBytes} 字节`);
  
  // 智能提取内容，尽可能多地展示信息（按字节计算）
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
    
    // 检查是否是重要内容行
    const isHeading = line.match(/^##\s+/); // H2 标题（月份）
    const isListItem = line.match(/^[\d\-\*]\s+/); // 列表项
    const isQuote = line.match(/^>\s+/); // 引用块
    
    // 构建要添加的行
    let lineToAdd = line;
    
    // 对长行进行智能截断（保守估计：每行最多300字节）
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (!isHeading && lineBytes > 300) {
      // 逐渐截断直到字节数符合要求
      let truncateLength = Math.floor(line.length * 300 / lineBytes) - 10; // 保守估计
      while (Buffer.byteLength(lineToAdd, 'utf8') > 300 && truncateLength > 0) {
        lineToAdd = line.substring(0, truncateLength) + '...';
        truncateLength -= 10;
      }
    }
    
    // 检查添加这一行后是否会超出限制（+1 for newline）
    const lineByteLength = Buffer.byteLength(lineToAdd + '\n', 'utf8');
    if (currentBytes + lineByteLength > availableBytes) {
      truncated = true;
      break;
    }
    
    // 添加这一行
    previewLines.push(lineToAdd);
    currentBytes += lineByteLength;
  }
  
  // 组装预览内容
  let previewContent = previewLines.join('\n');
  
  // 如果没有提取到任何内容，使用降级方案
  if (!previewContent.trim()) {
    // 逐字符截取直到字节数符合
    let charCount = Math.floor(availableBytes / 3); // 保守估计：中文3字节/字符
    previewContent = newSnapshot.textContent.substring(0, charCount);
    while (Buffer.byteLength(previewContent, 'utf8') > availableBytes) {
      charCount -= 10;
      previewContent = newSnapshot.textContent.substring(0, charCount);
    }
    truncated = true;
  }
  
  const previewBytes = Buffer.byteLength(previewContent, 'utf8');
  console.log(`[推送] 📊 预览内容: ${previewContent.length} 字符 / ${previewBytes} 字节, 是否截断: ${truncated}`);
  
  // 组装最终内容
  let content = header + previewContent;
  if (truncated) {
    content += truncationNotice;
  }
  content += footer;
  
  const contentBytes = Buffer.byteLength(content, 'utf8');
  console.log(`[推送] 📊 最终内容: ${content.length} 字符 / ${contentBytes} 字节`);
  
  // 最终安全检查
  if (contentBytes > MAX_BYTES) {
    console.log(`[推送] ⚠️ 内容仍然过长，进行强制截断...`);
    // 二分法截取，确保字节数不超限
    let charCount = Math.floor(content.length * MAX_BYTES / contentBytes) - 100;
    let safeContent = content.substring(0, charCount);
    while (Buffer.byteLength(safeContent + truncationNotice + footer, 'utf8') > MAX_BYTES && charCount > 0) {
      charCount -= 50;
      safeContent = content.substring(0, charCount);
    }
    content = safeContent + truncationNotice + footer;
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
      console.log('[推送] ✅ 变化通知推送成功');
    } else {
      console.error('[推送] ❌ 变化通知推送失败:', result.errmsg || '未知错误');
    }
  } catch (error) {
    console.error('[推送] ❌ 变化通知推送异常:', error instanceof Error ? error.message : String(error));
  }
}

async function pushDailyReport(webhookUrl: string, snapshot: ContentSnapshot): Promise<void> {
  console.log('[推送] 📊 发送每日健康报告...');
  
  const content = `# ✅ 微信小游戏更新日志监控报告\n\n` +
    `**检测时间**: ${new Date().toLocaleString('zh-CN')}\n\n` +
    `**最新更新**: ${snapshot.lastUpdated}\n` +
    `**内容长度**: ${snapshot.textContent.length} 字符\n` +
    `**状态**: 正常监控中 🎉\n\n` +
    `---\n\n` +
    `**数据来源**: https://developers.weixin.qq.com/minigame/introduction/release.html\n` +
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
}

async function main() {
  try {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) {
      console.error('❌ 错误: WEBHOOK_URL 环境变量未设置');
      process.exit(1);
    }

    console.log('========== 微信小游戏更新日志监控 开始 ==========');
    console.log(`⏱️  执行时间: ${new Date().toLocaleString('zh-CN')}\n`);

    const historyData = readHistoryData();
    if (historyData) {
      console.log(`[存储] 📁 读取到历史数据 (上次检查: ${new Date(historyData.lastCheckTime).toLocaleString('zh-CN')})`);
      console.log(`[存储] 📊 历史变更记录: ${historyData.changeHistory.length} 条`);
    } else {
      console.log('[存储] 📁 未找到历史数据，这是首次运行');
    }

    const snapshot = await fetchWeixinContent();

    if (!snapshot.html) {
      console.error('❌ 未获取到任何内容');
      process.exit(1);
    }

    let changes = '';
    if (historyData && historyData.currentSnapshot) {
      changes = detectChanges(historyData.currentSnapshot, snapshot);
      
      if (changes) {
        console.log(`[对比] 🔍 检测到内容变化: ${changes}`);
        await pushChangeNotification(webhookUrl, changes, snapshot);
        saveHistoryData(snapshot, changes);
      } else {
        console.log('[对比] ✅ 与上次检测相比，内容无变化');
        console.log('[存储] ⏭️ 数据无变化，跳过保存和提交');
      }
    } else {
      console.log('[存储] 📝 首次运行，保存初始数据');
      saveHistoryData(snapshot, '');
    }

    // 检查是否需要发送每日健康报告(每天早上9点)
    const now = new Date();
    const hour = now.getUTCHours() + 8;
    const adjustedHour = hour >= 24 ? hour - 24 : hour;
    const forceReport = process.env.FORCE_REPORT === 'true';
    const shouldSendDailyReport = forceReport || (adjustedHour === 9 && !changes);

    if (shouldSendDailyReport) {
      await pushDailyReport(webhookUrl, snapshot);
    }

    console.log('========== 微信小游戏更新日志监控 结束 ==========');
  } catch (error) {
    console.error('❌ 脚本执行失败:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
