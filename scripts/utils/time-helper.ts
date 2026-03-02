/**
 * 时间工具类
 * 提供时间相关的通用功能
 */

/**
 * 获取北京时间的小时数(0-23)
 */
export function getBeijingHour(): number {
  const now = new Date();
  const hour = now.getUTCHours() + 8; // UTC+8
  return hour >= 24 ? hour - 24 : hour;
}

/**
 * 判断是否应该发送每日报告
 * @param targetHour 目标小时(北京时间)，默认 9 点
 * @param forceReport 是否强制发送
 * @param hasChanges 是否有变化
 */
export function shouldSendDailyReport(
  targetHour: number = 9,
  forceReport: boolean = false,
  hasChanges: boolean = false
): boolean {
  if (forceReport) {
    console.log('[时间] 🔔 强制发送报告模式');
    return true;
  }

  const currentHour = getBeijingHour();
  const shouldSend = currentHour === targetHour && !hasChanges;
  
  if (shouldSend) {
    console.log(`[时间] 📅 当前时间: ${currentHour}:00 (北京时间)，触发每日报告`);
  } else {
    console.log(`[时间] ⏰ 当前时间: ${currentHour}:00 (北京时间)，不在报告时间段`);
  }
  
  return shouldSend;
}

/**
 * 格式化时间为本地字符串
 */
export function formatLocalTime(date?: Date): string {
  return (date || new Date()).toLocaleString('zh-CN');
}

/**
 * 格式化时间为 ISO 字符串
 */
export function formatISOTime(date?: Date): string {
  return (date || new Date()).toISOString();
}

/**
 * 计算两个时间之间的差异(毫秒)
 */
export function getTimeDiff(startTime: Date | string, endTime?: Date | string): number {
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const end = endTime ? (typeof endTime === 'string' ? new Date(endTime) : endTime) : new Date();
  return end.getTime() - start.getTime();
}

/**
 * 格式化时间差为可读字符串
 */
export function formatTimeDiff(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}天${hours % 24}小时`;
  } else if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds % 60}秒`;
  } else {
    return `${seconds}秒`;
  }
}
