/**
 * 浏览器工具类
 * 提供统一的 Playwright 浏览器操作功能
 */

import { chromium, Browser, Page } from 'playwright';

export interface BrowserConfig {
  headless?: boolean;
  timeout?: number;
  userAgent?: string;
}

export interface NavigateConfig {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  timeout?: number;
  waitForSelector?: string;
  selectorTimeout?: number;
}

/**
 * 启动浏览器并访问页面
 */
export async function launchBrowserAndNavigate(
  url: string,
  config?: NavigateConfig
): Promise<{ browser: Browser; page: Page }> {
  console.log('[浏览器] 🚀 启动浏览器...');
  const browser = await chromium.launch({
    headless: true,
  });
  
  const page = await browser.newPage();
  
  console.log(`[浏览器] 🌐 访问页面: ${url}`);
  await page.goto(url, {
    waitUntil: config?.waitUntil || 'networkidle',
    timeout: config?.timeout || 30000,
  });
  
  if (config?.waitForSelector) {
    console.log(`[浏览器] ⏳ 等待元素: ${config.waitForSelector}`);
    try {
      await page.waitForSelector(config.waitForSelector, {
        timeout: config.selectorTimeout || 10000,
      });
      console.log(`[浏览器] ✅ 元素已加载`);
    } catch (e) {
      console.warn(`[浏览器] ⚠️ 未找到目标元素，继续处理...`);
    }
  }
  
  // 额外等待确保内容加载完成
  await page.waitForTimeout(2000);
  
  return { browser, page };
}

/**
 * 安全关闭浏览器
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
    console.log('[浏览器] 🔒 浏览器已关闭');
  } catch (error) {
    console.error('[浏览器] ❌ 关闭浏览器失败:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * 使用浏览器执行操作(自动管理生命周期)
 */
export async function withBrowser<T>(
  url: string,
  action: (page: Page) => Promise<T>,
  config?: NavigateConfig
): Promise<T> {
  const { browser, page } = await launchBrowserAndNavigate(url, config);
  
  try {
    const result = await action(page);
    return result;
  } finally {
    await closeBrowser(browser);
  }
}

/**
 * 截图并保存
 */
export async function takeScreenshot(
  page: Page,
  filePath: string,
  fullPage: boolean = true
): Promise<void> {
  try {
    await page.screenshot({ path: filePath, fullPage });
    console.log(`[浏览器] 📸 截图已保存: ${filePath}`);
  } catch (error) {
    console.error('[浏览器] ❌ 截图失败:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * 提取页面文本内容
 */
export async function extractTextContent(page: Page, selector?: string): Promise<string> {
  try {
    const text = await page.evaluate((sel) => {
      const element = sel ? document.querySelector(sel) : document.body;
      return element?.textContent?.trim() || '';
    }, selector);
    
    console.log(`[浏览器] 📝 提取文本内容: ${text.length} 字符`);
    return text;
  } catch (error) {
    console.error('[浏览器] ❌ 提取文本失败:', error instanceof Error ? error.message : String(error));
    return '';
  }
}

/**
 * 提取页面 HTML
 */
export async function extractHTML(page: Page, selector?: string): Promise<string> {
  try {
    const html = await page.evaluate((sel) => {
      const element = sel ? document.querySelector(sel) : document.body;
      return element?.innerHTML || '';
    }, selector);
    
    console.log(`[浏览器] 📄 提取 HTML: ${html.length} 字符`);
    return html;
  } catch (error) {
    console.error('[浏览器] ❌ 提取 HTML 失败:', error instanceof Error ? error.message : String(error));
    return '';
  }
}
