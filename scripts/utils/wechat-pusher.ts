/**
 * 企业微信推送工具类
 * 提供统一的企业微信消息推送功能
 */

export interface WeChatMessage {
  msgtype: 'markdown_v2';
  markdown_v2: {
    content: string;
  };
}

export interface PushResult {
  success: boolean;
  index: number;
  error?: string;
}

/**
 * 解析 webhook URL(支持多个,用逗号分隔)
 */
export function parseWebhookUrls(): string[] {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('❌ 错误: WEBHOOK_URL 环境变量未设置');
    process.exit(1);
  }

  // 按逗号分隔并清理空格
  const urls = webhookUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
  
  if (urls.length === 0) {
    console.error('❌ 错误: WEBHOOK_URL 环境变量为空');
    process.exit(1);
  }

  console.log(`[配置] 🔗 已配置 ${urls.length} 个 Webhook 地址`);
  return urls;
}

/**
 * 向单个 webhook 发送消息
 */
async function sendToSingleWebhook(url: string, content: string, index: number, type: string): Promise<PushResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown_v2',
        markdown_v2: { content },
      } as WeChatMessage),
    });
    
    const result = await response.json();
    if (response.ok && result.errcode === 0) {
      console.log(`[推送] ✅ Webhook #${index + 1} ${type}推送成功`);
      return { success: true, index: index + 1 };
    } else {
      console.error(`[推送] ❌ Webhook #${index + 1} ${type}推送失败:`, result.errmsg || '未知错误');
      return { success: false, index: index + 1, error: result.errmsg };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[推送] ❌ Webhook #${index + 1} ${type}推送异常:`, errorMsg);
    return { success: false, index: index + 1, error: errorMsg };
  }
}

/**
 * 向多个 webhook 发送消息
 */
export async function sendToMultipleWebhooks(webhookUrls: string[], content: string, type: string): Promise<void> {
  console.log(`[推送] 📤 向 ${webhookUrls.length} 个 Webhook 发送${type}...`);
  
  const results = await Promise.allSettled(
    webhookUrls.map((url, index) => sendToSingleWebhook(url, content, index, type))
  );
  
  const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failCount = results.length - successCount;
  
  console.log(`[推送] 📊 ${type}推送完成: 成功 ${successCount}/${results.length}${failCount > 0 ? `，失败 ${failCount}` : ''}`);
}

/**
 * 检查内容字节长度并截断(企业微信限制 4096 字节)
 */
export function truncateContent(content: string, maxBytes: number = 4096): string {
  const contentBytes = Buffer.byteLength(content, 'utf8');
  
  if (contentBytes <= maxBytes) {
    return content;
  }

  console.log(`[推送] ⚠️ 内容超过 ${maxBytes} 字节限制 (${contentBytes} 字节)，进行截断...`);
  
  // 保守估算：逐步减少字符直到满足字节限制
  let truncated = content;
  while (Buffer.byteLength(truncated, 'utf8') > maxBytes - 100) { // 留100字节buffer
    truncated = truncated.substring(0, Math.floor(truncated.length * 0.9));
  }
  
  return truncated + '\n\n*...(内容过长已截断)*';
}

/**
 * 计算字符串的字节长度
 */
export function getByteLength(str: string): number {
  return Buffer.byteLength(str, 'utf8');
}

/**
 * 构建通用的消息头部
 */
export function buildMessageHeader(title: string, extraInfo?: Record<string, string>): string {
  let header = `# ${title}\n\n`;
  header += `**检测时间**: ${new Date().toLocaleString('zh-CN')}\n`;
  
  if (extraInfo) {
    for (const [key, value] of Object.entries(extraInfo)) {
      header += `**${key}**: ${value}\n`;
    }
  }
  
  header += '\n---\n\n';
  return header;
}

/**
 * 构建通用的消息尾部
 */
export function buildMessageFooter(sourceUrl?: string): string {
  let footer = '\n\n---\n\n';
  
  if (sourceUrl) {
    footer += `**数据来源**: ${sourceUrl}\n`;
  }
  
  footer += `*自动生成于 ${new Date().toLocaleString('zh-CN')}*`;
  return footer;
}
