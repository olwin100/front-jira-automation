import dotenv from 'dotenv';
import { execSync } from 'child_process';

// Load environment variables
dotenv.config();

/**
 * Get screen dimensions (width and height)
 * Returns default values if detection fails
 */
function getScreenDimensions() {
  try {
    // Try to get screen dimensions on macOS
    if (process.platform === 'darwin') {
      const output = execSync('system_profiler SPDisplaysDataType | grep -E "Resolution:|Main Display"', { encoding: 'utf-8' });
      // Parse output to get resolution (format: "Resolution: 1920 x 1080")
      const resolutionMatch = output.match(/(\d+)\s*x\s*(\d+)/);
      if (resolutionMatch) {
        const width = parseInt(resolutionMatch[1]);
        const height = parseInt(resolutionMatch[2]);
        return { width, height };
      }
    }
  } catch (error) {
    // Fall back to defaults if detection fails
    console.warn('⚠️ Could not detect screen dimensions, using defaults');
  }
  
  // Default to common screen sizes (will use half width for right half)
  // Common resolutions: 1920x1080, 2560x1440, 2880x1800
  return {
    width: parseInt(process.env.SCREEN_WIDTH) || 1920,
    height: parseInt(process.env.SCREEN_HEIGHT) || 1080,
  };
}

const screenDimensions = getScreenDimensions();
const halfWidth = Math.floor(screenDimensions.width / 2);
const fullHeight = screenDimensions.height;

export const JIRA_CONFIG = {
  // Jira instance URL
  baseUrl: process.env.JIRA_BASE_URL || 'https://redventures.atlassian.net',
  dashboardUrl: process.env.JIRA_DASHBOARD_URL || 'https://redventures.atlassian.net/jira/software/c/projects/FRONT/boards/3839?assignee=712020%3A417e205f-b507-4575-8bf4-ddaf69b31de0',

  // Credentials
  credentials: {
    email: process.env.JIRA_EMAIL || 'olwin@redventures.com',
  },

  // Chrome executable path (update this for your system)
  chromePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',

  // Default selectors for common Jira elements
  selectors: {
    createButton: 'button[data-testid="atlassian-navigation--create-button"]',
    createButtonFallback: 'button:has-text("Create"), a[href*="CreateIssue"], button[data-testid="create-button"], [aria-label*="Create"]',
    loginButton: '#login-form-submit, button[type="submit"]',
    usernameInput: '#username-uid12, #username, input[name="username"], input[type="email"], input[placeholder*="email"], input[placeholder*="Email"]',
    passwordInput: '#password, input[name="password"], input[type="password"]',
    authTokenInput: 'input[name="otp"], input[name="token"], input[type="text"][placeholder*="token"], input[type="text"][placeholder*="code"], input[type="text"][placeholder*="authenticator"]',
    validEntropyNumber: '#validEntropyNumber',
    dashboardTitle: 'h1, .page-header, [data-testid="dashboard-title"]',
    userMenu: '#user-options, .user-menu, [data-testid="user-menu"]',
  },

  // Timeout settings (in milliseconds)
  timeouts: {
    default: 10000,
    navigation: 60000, // Increased to 60 seconds
    element: 5000,
  },

  // Browser settings - Full screen on right half
  browser: {
    headless: false,
    slowMo: 300,
    viewport: { width: halfWidth, height: fullHeight },
    args: [
      `--window-position=${halfWidth},0`,  // Position at right half (middle of screen)
      `--window-size=${halfWidth},${fullHeight}`,  // Half width, full height
    ],
  }
};

// Validate required environment variables
export function validateConfig() {
  // Email is optional as it has a default value
  // No required env vars for now, but can be extended
}

