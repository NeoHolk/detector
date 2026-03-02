/**
 * 数据存储工具类
 * 提供统一的历史数据读写功能
 */

import * as fs from 'fs';
import * as path from 'path';

export interface BaseHistoryData<T> {
  lastCheckTime: string;
  currentData: T;
  changeHistory: any[];
}

/**
 * 确保目录存在
 */
function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`[存储] 📁 创建目录: ${dirPath}`);
  }
}

/**
 * 读取历史数据
 */
export function readHistoryData<T>(dataFileName: string): BaseHistoryData<T> | null {
  const dataPath = path.join(process.cwd(), 'data', dataFileName);
  try {
    if (fs.existsSync(dataPath)) {
      const content = fs.readFileSync(dataPath, 'utf-8');
      const data = JSON.parse(content);
      console.log(`[存储] ✅ 成功读取历史数据: ${dataPath}`);
      return data;
    } else {
      console.log(`[存储] ℹ️ 历史数据文件不存在: ${dataPath}`);
      return null;
    }
  } catch (error) {
    console.error(`[存储] ❌ 读取历史数据失败:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * 保存历史数据
 */
export function saveHistoryData<T>(
  dataFileName: string,
  currentData: T,
  newChange?: any
): void {
  const dataDir = path.join(process.cwd(), 'data');
  const dataPath = path.join(dataDir, dataFileName);

  ensureDirectoryExists(dataDir);

  // 读取现有历史记录
  let changeHistory: any[] = [];
  try {
    if (fs.existsSync(dataPath)) {
      const existingData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      changeHistory = existingData.changeHistory || [];
    }
  } catch (error) {
    console.warn('[存储] ⚠️ 无法读取现有历史记录，将创建新记录');
  }

  // 添加新的变更记录
  if (newChange) {
    changeHistory.push({
      timestamp: new Date().toISOString(),
      changes: newChange,
    });
  }

  const historyData: BaseHistoryData<T> = {
    lastCheckTime: new Date().toISOString(),
    currentData,
    changeHistory,
  };

  try {
    fs.writeFileSync(dataPath, JSON.stringify(historyData, null, 2), 'utf-8');
    console.log(`[存储] ✅ 历史数据已保存: ${dataPath}`);
  } catch (error) {
    console.error(`[存储] ❌ 保存历史数据失败:`, error instanceof Error ? error.message : String(error));
  }
}

/**
 * 清空历史数据
 */
export function clearHistoryData(dataFileName: string): void {
  const dataPath = path.join(process.cwd(), 'data', dataFileName);
  try {
    if (fs.existsSync(dataPath)) {
      fs.unlinkSync(dataPath);
      console.log(`[存储] 🗑️ 历史数据已清空: ${dataPath}`);
    }
  } catch (error) {
    console.error(`[存储] ❌ 清空历史数据失败:`, error instanceof Error ? error.message : String(error));
  }
}

/**
 * 获取历史数据文件路径
 */
export function getHistoryDataPath(dataFileName: string): string {
  return path.join(process.cwd(), 'data', dataFileName);
}
