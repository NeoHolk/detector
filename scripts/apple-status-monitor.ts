import { chromium } from 'playwright';
import * as dotenv from 'dotenv';

// 加载 .env 文件(仅本地开发时使用)
dotenv.config();

interface Service {
  serviceName: string;
  status: 'operational' | 'degraded' | 'down' | 'unknown';
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
