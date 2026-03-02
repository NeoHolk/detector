/**
 * 日志工具类
 * 提供统一的日志输出功能
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS',
}

const LOG_COLORS = {
  [LogLevel.DEBUG]: '🔍',
  [LogLevel.INFO]: 'ℹ️',
  [LogLevel.WARN]: '⚠️',
  [LogLevel.ERROR]: '❌',
  [LogLevel.SUCCESS]: '✅',
};

/**
 * 格式化日志输出
 */
function formatLog(level: LogLevel, module: string, message: string, ...args: any[]): string {
  const emoji = LOG_COLORS[level] || '';
  const timestamp = new Date().toLocaleString('zh-CN');
  return `[${timestamp}] ${emoji} [${module}] ${message}`;
}

/**
 * 输出调试日志
 */
export function logDebug(module: string, message: string, ...args: any[]): void {
  console.debug(formatLog(LogLevel.DEBUG, module, message), ...args);
}

/**
 * 输出信息日志
 */
export function logInfo(module: string, message: string, ...args: any[]): void {
  console.log(formatLog(LogLevel.INFO, module, message), ...args);
}

/**
 * 输出警告日志
 */
export function logWarn(module: string, message: string, ...args: any[]): void {
  console.warn(formatLog(LogLevel.WARN, module, message), ...args);
}

/**
 * 输出错误日志
 */
export function logError(module: string, message: string, ...args: any[]): void {
  console.error(formatLog(LogLevel.ERROR, module, message), ...args);
}

/**
 * 输出成功日志
 */
export function logSuccess(module: string, message: string, ...args: any[]): void {
  console.log(formatLog(LogLevel.SUCCESS, module, message), ...args);
}

/**
 * 输出分隔线
 */
export function logSeparator(title?: string): void {
  if (title) {
    console.log(`\n${'='.repeat(10)} ${title} ${'='.repeat(10)}\n`);
  } else {
    console.log(`\n${'='.repeat(50)}\n`);
  }
}

/**
 * 输出监控脚本开始信息
 */
export function logMonitorStart(scriptName: string): void {
  logSeparator(`${scriptName} 开始`);
  logInfo('监控', `⏱️  执行时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log();
}

/**
 * 输出监控脚本结束信息
 */
export function logMonitorEnd(scriptName: string): void {
  logSeparator(`${scriptName} 结束`);
}

/**
 * 输出统计信息
 */
export function logStatistics(title: string, stats: Record<string, any>): void {
  console.log(`\n[统计] 📊 ${title}:`);
  for (const [key, value] of Object.entries(stats)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log();
}
