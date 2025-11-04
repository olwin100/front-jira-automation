import { chromium } from "playwright";
import { JIRA_CONFIG, validateConfig } from "../config/jira-config.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const STATE_FILE = path.join(process.cwd(), "persistence", "jira-session-state.json");
const BROWSER_STATE_FILE = path.join(process.cwd(), "persistence", "jira-browser-state.json");

// Global browser instance management
let globalBrowser = null;
let globalContext = null;
let globalPage = null;

/**
 * Get or create global browser instance
 */
export async function getGlobalBrowser() {
  if (!globalBrowser) {
    console.log("🚀 Creating new browser instance...");
    try {
      globalBrowser = await chromium.launch({
        executablePath: JIRA_CONFIG.chromePath,
        headless: false,
        slowMo: JIRA_CONFIG.browser.slowMo,
        args: JIRA_CONFIG.browser.args || [],
      });

      // Save browser info for potential reuse
      const browserInfo = {
        createdAt: new Date().toISOString(),
        baseUrl: JIRA_CONFIG.baseUrl,
        userEmail: JIRA_CONFIG.credentials.email,
      };

      try {
        fs.mkdirSync(path.dirname(BROWSER_STATE_FILE), { recursive: true });
        fs.writeFileSync(
          BROWSER_STATE_FILE,
          JSON.stringify(browserInfo, null, 2),
        );
        console.log("💾 Browser instance info saved");
      } catch (error) {
        console.warn("⚠️ Could not save browser info:", error.message);
      }
    } catch (error) {
      console.error("❌ Failed to create browser instance:", error.message);
      throw error;
    }
  } else {
    console.log("🔄 Reusing existing browser instance");
  }

  return globalBrowser;
}

/**
 * Get or create global context
 */
export async function getGlobalContext() {
  const browser = await getGlobalBrowser();

  if (!globalContext) {
    console.log("🔄 Creating new browser context...");

    try {
      // Try to load saved state first
      const savedState = loadBrowserState();
      if (savedState) {
        try {
          globalContext = await browser.newContext({
            storageState: savedState,
          });
          console.log("✅ Restored context from saved state");
        } catch (error) {
          console.warn(
            "⚠️ Failed to restore context from saved state, creating fresh context",
          );
          globalContext = await browser.newContext();
        }
      } else {
        globalContext = await browser.newContext();
      }
    } catch (error) {
      console.error("❌ Failed to create browser context:", error.message);
      throw error;
    }
  } else {
    console.log("🔄 Reusing existing browser context");
  }

  return globalContext;
}

/**
 * Get or create global page
 */
export async function getGlobalPage() {
  const context = await getGlobalContext();

  if (!globalPage) {
    console.log("🔄 Creating new page...");
    try {
      globalPage = await context.newPage();
      await globalPage.setViewportSize(JIRA_CONFIG.browser.viewport);
    } catch (error) {
      console.error("❌ Failed to create page:", error.message);
      throw error;
    }
  } else {
    console.log("🔄 Reusing existing page");
  }

  return globalPage;
}

/**
 * Clean up global browser instance
 */
export async function cleanupGlobalBrowser() {
  try {
    if (globalPage) {
      await globalPage.close();
      globalPage = null;
    }
    if (globalContext) {
      await globalContext.close();
      globalContext = null;
    }
    if (globalBrowser) {
      await globalBrowser.close();
      globalBrowser = null;
    }
    console.log("🧹 Global browser instance cleaned up");
  } catch (error) {
    console.warn("⚠️ Error cleaning up global browser:", error.message);
  }
}

/**
 * Save browser state to file for reuse
 */
async function saveBrowserState(browser, page = null) {
  try {
    const context = browser.contexts()[0];
    if (context) {
      const state = await context.storageState();

      // Enhanced state data with additional session info
      const enhancedState = {
        ...state,
        metadata: {
          savedAt: new Date().toISOString(),
          dashboardUrl: page ? page.url() : null,
          baseUrl: JIRA_CONFIG.baseUrl,
          userEmail: JIRA_CONFIG.credentials.email,
        },
      };

      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(enhancedState, null, 2));
      console.log("💾 Browser state saved for future reuse");
      if (page) {
        console.log(`📍 Dashboard URL saved: ${page.url()}`);
      }
    }
  } catch (error) {
    console.warn("⚠️ Could not save browser state:", error.message);
  }
}

/**
 * Load browser state from file if it exists
 */
export function loadBrowserState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

      // Check if state has metadata and validate it
      if (state.metadata) {
        const { savedAt, baseUrl, userEmail } = state.metadata;
        const currentBaseUrl = JIRA_CONFIG.baseUrl;
        const currentUserEmail = JIRA_CONFIG.credentials.email;

        // Validate base URL and user email match
        if (baseUrl === currentBaseUrl && userEmail === currentUserEmail) {
          console.log("📂 Loaded saved browser state");
          console.log(`📅 State saved at: ${savedAt}`);
          console.log(
            `📍 Dashboard URL: ${state.metadata.dashboardUrl || "Not available"}`,
          );
          return state;
        } else {
          console.log(
            "⚠️ Saved state is for different Jira instance or user, ignoring",
          );
          return null;
        }
      } else {
        // Legacy state without metadata
        console.log("📂 Loaded saved browser state (legacy format)");
        return state;
      }
    }
  } catch (error) {
    console.warn("⚠️ Could not load saved browser state:", error.message);
  }
  return null;
}

/**
 * Close browser after successful login
 */
async function closeBrowserOnSuccess(browser, page, context, shouldCloseBrowser) {
  try {
    console.log("🔒 Closing browser after successful login...");
    if (page) {
      await page.close();
      // Reset global page if it was set
      if (globalPage === page) {
        globalPage = null;
      }
    }
    if (context) {
      await context.close();
      // Reset global context if it was set
      if (globalContext === context) {
        globalContext = null;
      }
    }
    if (browser && shouldCloseBrowser) {
      await browser.close();
      // Reset global browser if it was set
      if (globalBrowser === browser) {
        globalBrowser = null;
      }
    }
    console.log("✅ Browser closed successfully");
  } catch (error) {
    console.warn("⚠️ Error closing browser:", error.message);
  }
}

/**
 * Check if already logged in by checking if create button is visible
 * and checking for login prompt
 */
export async function checkLoggedIn(page) {
  try {
    // Check if "Log in to continue" heading exists (indicates not logged in)
    const loginHeading = page.locator('#ProductHeadingSuffix > h1');
    const hasLoginHeading = await loginHeading.isVisible().catch(() => false);
    
    if (hasLoginHeading) {
      const headingText = await loginHeading.textContent().catch(() => '');
      if (headingText && headingText.includes('Log in to continue')) {
        console.log("⚠️ Login required: 'Log in to continue' heading found");
        return false;
      }
    }
    
    // Check if create button is visible (indicates logged in)
    const createButton = page.locator(JIRA_CONFIG.selectors.createButton).first();
    const isCreateButtonVisible = await createButton.isVisible().catch(() => false);
    
    if (!isCreateButtonVisible) {
      // Try fallback selector
      const fallbackButton = page.locator(JIRA_CONFIG.selectors.createButtonFallback).first();
      const isFallbackVisible = await fallbackButton.isVisible().catch(() => false);
      if (isFallbackVisible) {
        console.log("✅ Already logged in! Create button is visible.");
        const currentUrl = page.url();
        console.log(`📍 Current URL: ${currentUrl}`);
        return true;
      }
    } else {
      console.log("✅ Already logged in! Create button is visible.");
      const currentUrl = page.url();
      console.log(`📍 Current URL: ${currentUrl}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.warn("⚠️ Error checking login status:", error.message);
    return false;
  }
}

/**
 * Login function that opens the specific Jira board URL
 * @param {Object} options - Configuration options
 * @param {boolean} options.saveState - Whether to save state for reuse (default: true)
 * @param {boolean} options.standalone - Whether running standalone (default: false)
 * @returns {Object} - Returns { success: boolean, browser?: Browser, page?: Page, context?: BrowserContext }
 */
export async function loginToJira(options = {}) {
  const {
    saveState = true,
    standalone = false,
    useGlobalBrowser = true,
  } = options;

  // Validate configuration first
  try {
    validateConfig();
  } catch (error) {
    console.error("❌ Configuration error:", error.message);
    return { success: false, error: error.message };
  }

  console.log("🔐 Attempting to login to Jira...");
  console.log(`📧 Email: ${JIRA_CONFIG.credentials.email}`);
  console.log(`🌐 URL: ${JIRA_CONFIG.dashboardUrl}`);

  let browser = null;
  let page = null;
  let context = null;
  let shouldCloseBrowser = false;

  try {
    // Use global browser instance if requested
    if (useGlobalBrowser) {
      try {
        browser = await getGlobalBrowser();
        context = await getGlobalContext();
        page = await getGlobalPage();
      } catch (error) {
        console.warn(
          "⚠️ Global browser failed, falling back to fresh browser instance",
        );
        console.warn("Error:", error.message);
        globalBrowser = null;
        globalContext = null;
        globalPage = null;
      }
    }

    // If global browser failed or not requested, create fresh browser
    if (!browser) {
      browser = await chromium.launch({
        executablePath: JIRA_CONFIG.chromePath,
        headless: false,
        slowMo: JIRA_CONFIG.browser.slowMo,
        args: JIRA_CONFIG.browser.args || [],
      });
      shouldCloseBrowser = true;
    }

    // If no existing page provided, create new one
    if (!page) {
      context = browser.contexts()[0] || (await browser.newContext());
      
      // Try to load saved state
      const savedState = loadBrowserState();
      if (savedState) {
        try {
          context = await browser.newContext({ storageState: savedState });
          console.log("🔄 Using saved browser state");
        } catch (error) {
          console.warn("⚠️ Failed to use saved state, creating fresh context");
          context = await browser.newContext();
        }
      }

      page = await context.newPage();
      await page.setViewportSize(JIRA_CONFIG.browser.viewport);
    }

    // Try to resume from saved dashboard URL first
    const savedState = loadBrowserState();
    if (savedState && savedState.metadata && savedState.metadata.dashboardUrl) {
      console.log("🔄 Attempting to resume from saved dashboard...");
      try {
        await page.goto(savedState.metadata.dashboardUrl, {
          waitUntil: "domcontentloaded",
          timeout: JIRA_CONFIG.timeouts.navigation,
        });

        // Wait for page to load
        await page.waitForTimeout(2000);

        // Check if create button is visible to verify we're still logged in
        const createButton = page.locator(JIRA_CONFIG.selectors.createButton).first();
        const isCreateButtonVisible = await createButton.isVisible().catch(() => false);
        
        if (!isCreateButtonVisible) {
          // Try fallback selector
          const fallbackButton = page.locator(JIRA_CONFIG.selectors.createButtonFallback).first();
          const isFallbackVisible = await fallbackButton.isVisible().catch(() => false);
          if (isFallbackVisible) {
            console.log("✅ Successfully resumed from saved state! Create button is visible.");
            // Don't save state or close browser when resuming - just return success
            return { success: true, browser, page, context };
          }
        } else {
          console.log("✅ Successfully resumed from saved state! Create button is visible.");
          // Don't save state or close browser when resuming - just return success
          return { success: true, browser, page, context };
        }
        
        console.log("⚠️ Saved state expired - create button not found, proceeding with fresh login");
      } catch (error) {
        console.log(
          "⚠️ Could not resume from saved state, proceeding with fresh login",
        );
      }
    }

    // Navigate directly to the Jira board URL
    console.log("📱 Navigating to Jira board...");
    await page.goto(JIRA_CONFIG.dashboardUrl, {
      waitUntil: "domcontentloaded",
      timeout: JIRA_CONFIG.timeouts.navigation,
    });

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Check if already logged in (using centralized check)
    if (await checkLoggedIn(page)) {
      console.log("✅ Already logged in!");
      // Don't save state or close browser if already logged in - just return success
      return { success: true, browser, page, context };
    }

    // Check if login prompt is visible (means we need to login)
    const loginHeading = page.locator('#ProductHeadingSuffix > h1');
    const hasLoginHeading = await loginHeading.isVisible().catch(() => false);
    
    if (hasLoginHeading) {
      const headingText = await loginHeading.textContent().catch(() => '');
      if (headingText && headingText.includes('Log in to continue')) {
        console.log("🔐 Login prompt detected, proceeding with login...");
      }
    }

    // Look for username input field
    console.log("🔍 Looking for username input...");
    const usernameInput = page.locator(JIRA_CONFIG.selectors.usernameInput);
    
    // Wait for username input to appear
    await usernameInput.waitFor({ state: "visible", timeout: JIRA_CONFIG.timeouts.element }).catch(() => {
      console.log("⚠️ Username input not found, checking if already logged in...");
    });

    if (await usernameInput.isVisible()) {
      console.log("📝 Filling username...");
      
      // Fill in username
      await usernameInput.fill(JIRA_CONFIG.credentials.email);
      
      // Press Enter
      console.log("⌨️ Pressing Enter...");
      await page.keyboard.press("Enter");

      // Wait 10 seconds for user to provide fingerprint/authentication
      console.log("⏳ Waiting 10 seconds for fingerprint authentication...");
      await page.waitForTimeout(10000);

      // Check if URL already contains redventures.atlassian.net after waiting
      let currentUrl = page.url();
      if (currentUrl.includes('redventures.atlassian.net')) {
        console.log("✅ Login successful! URL already contains redventures.atlassian.net");
        console.log(`📍 Current URL: ${currentUrl}`);
        
        // Wait a moment for page to fully load
        await page.waitForTimeout(2000);

        // Save enhanced state with dashboard info (only on successful login)
        if (saveState && context) {
          await saveBrowserState(browser, page);
        }

        // Close browser after successful login
        await closeBrowserOnSuccess(browser, page, context, shouldCloseBrowser);
        
        return { success: true, browser: null, page: null, context: null };
      }

      // Wait for URL to change to redventures.atlassian.net (indicating successful login)
      console.log("🔍 Waiting for URL to change to redventures.atlassian.net...");
      
      try {
        const startTime = Date.now();
        const timeout = 60000; // Wait up to 60 seconds for URL change
        let loginSuccessful = false;

        while (Date.now() - startTime < timeout && !loginSuccessful) {
          // Check if URL has changed to redventures.atlassian.net
          const newUrl = page.url();
          if (newUrl !== currentUrl && newUrl.includes('redventures.atlassian.net')) {
            loginSuccessful = true;
            currentUrl = newUrl;
            break;
          }

          // Small delay before checking again
          await page.waitForTimeout(1000);
        }

        if (loginSuccessful) {
          console.log("✅ Login successful! URL changed to redventures.atlassian.net");
          console.log(`📍 Current URL: ${currentUrl}`);
          
          // Wait a moment for page to fully load
          await page.waitForTimeout(2000);

          // Save enhanced state with dashboard info (only on successful login)
          if (saveState && context) {
            await saveBrowserState(browser, page);
          }

          // Close browser after successful login
          await closeBrowserOnSuccess(browser, page, context, shouldCloseBrowser);
          
          return { success: true, browser: null, page: null, context: null };
        } else {
          console.error("❌ URL did not change to redventures.atlassian.net within timeout");
          console.log(`📍 Current URL: ${currentUrl}`);
          return {
            success: false,
            error: "URL did not change to redventures.atlassian.net - login may have failed",
          };
        }
      } catch (error) {
        console.error("❌ Error waiting for URL change:", error.message);
        console.log(`📍 Current URL: ${page.url()}`);
        return {
          success: false,
          error: `Error waiting for URL change: ${error.message}`,
        };
      }
    } else {
      // Check if already logged in (no username field means might be logged in)
      if (await checkLoggedIn(page)) {
        console.log("✅ Already logged in!");
        // Don't save state or close browser if already logged in - just return success
        return { success: true, browser, page, context };
      } else {
        console.log("⚠️ Username input not found and not logged in");
        return {
          success: false,
          error: "Could not find username input field",
        };
      }
    }
  } catch (error) {
    console.error("❌ Error during login:", error.message);
    if (page) {
      try {
        const screenshotPath = path.join(process.cwd(), "screenshots", "login-error-screenshot.png");
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath });
        console.log(`📸 Screenshot saved as ${screenshotPath}`);
      } catch (screenshotError) {
        console.warn("⚠️ Could not save screenshot:", screenshotError.message);
      }
    }
    return { success: false, error: error.message };
  } finally {
    if (standalone && shouldCloseBrowser) {
      console.log(
        "🏁 Login test completed. Browser will remain open for inspection.",
      );
    }
  }
}

/**
 * Standalone login test function
 */
async function testLogin() {
  const result = await loginToJira({ standalone: true });

  if (result.success) {
    console.log("✅ Standalone login test completed successfully");
    console.log("🏁 Exiting...");
  } else {
    console.error("❌ Standalone login test failed:", result.error);
    process.exit(1);
  }
}

/**
 * Ensure user is logged in - creates browser session if needed
 * @param {Object} options - Configuration options
 * @param {boolean} options.saveState - Whether to save state for reuse (default: true)
 * @returns {Object} - Returns { success: boolean, browser?: Browser, page?: Page, context?: BrowserContext }
 */
export async function ensureLoggedIn(options = {}) {
  const { saveState = true } = options;
  
  // Check if we have saved state
  const savedState = loadBrowserState();
  
  if (!savedState) {
    console.log("🔐 No saved session found. Logging in first...");
    const loginResult = await loginToJira({ 
      saveState: true,
      useGlobalBrowser: false 
    });

    if (!loginResult.success) {
      return { success: false, error: loginResult.error };
    }

    // Login closes the browser, so we need to create a new browser with saved state
    console.log("🔄 Creating new browser session with saved state...");
  }

  // Create browser with saved state (if available)
  const browser = await chromium.launch({
    executablePath: JIRA_CONFIG.chromePath,
    headless: false,
    slowMo: JIRA_CONFIG.browser.slowMo,
    args: JIRA_CONFIG.browser.args || [],
  });

  // Load saved state if available
  const stateToUse = loadBrowserState();
  let context;
  if (stateToUse) {
    context = await browser.newContext({ storageState: stateToUse });
    console.log("✅ Restored session from saved state");
  } else {
    context = await browser.newContext();
  }

  const page = await context.newPage();
  await page.setViewportSize(JIRA_CONFIG.browser.viewport);

  // Navigate to the Jira board URL
  console.log("📱 Navigating to Jira board...");
  await page.goto(JIRA_CONFIG.dashboardUrl, {
    waitUntil: "domcontentloaded",
    timeout: JIRA_CONFIG.timeouts.navigation,
  });

  // Wait for page to load
  await page.waitForTimeout(2000);

  // Check if we're logged in (check for login prompt first)
  const isLoggedIn = await checkLoggedIn(page);
  if (!isLoggedIn) {
    console.log("🔐 Not logged in. Attempting to login...");
    // Close current browser and login
    await page.close();
    await context.close();
    await browser.close();
    
    const loginResult = await loginToJira({ 
      saveState: true,
      useGlobalBrowser: false 
    });

    if (!loginResult.success) {
      return { success: false, error: loginResult.error };
    }

    // Create new browser with saved state
    const newBrowser = await chromium.launch({
      executablePath: JIRA_CONFIG.chromePath,
      headless: false,
      slowMo: JIRA_CONFIG.browser.slowMo,
      args: JIRA_CONFIG.browser.args || [],
    });

    const newStateToUse = loadBrowserState();
    let newContext;
    if (newStateToUse) {
      newContext = await newBrowser.newContext({ storageState: newStateToUse });
    } else {
      newContext = await newBrowser.newContext();
    }

    const newPage = await newContext.newPage();
    await newPage.setViewportSize(JIRA_CONFIG.browser.viewport);
    
    // Navigate to board again after login
    console.log("📱 Navigating to Jira board after login...");
    await newPage.goto(JIRA_CONFIG.dashboardUrl, {
      waitUntil: "domcontentloaded",
      timeout: JIRA_CONFIG.timeouts.navigation,
    });
    
    await newPage.waitForTimeout(2000);
    
    // Verify we're logged in now
    const stillLoggedIn = await checkLoggedIn(newPage);
    if (!stillLoggedIn) {
      await newPage.close();
      await newContext.close();
      await newBrowser.close();
      return { success: false, error: "Still not logged in after login attempt" };
    }
    
    return { success: true, browser: newBrowser, page: newPage, context: newContext };
  }
  
  return { success: true, browser, page, context };
}

// Run standalone test if this file is executed directly
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  testLogin().catch(console.error);
}

