# Environment Variables Template

Copy this template to create your `.env` file:

```bash
# JIRA Configuration
JIRA_EMAIL=olwin@redventures.com
JIRA_BASE_URL=https://redventures.atlassian.net
CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

## Required Variables

- `JIRA_EMAIL`: Your JIRA login email (default: olwin@redventures.com)
- `JIRA_BASE_URL`: Your JIRA instance URL (default: https://redventures.atlassian.net)
- `CHROME_PATH`: Path to Chrome executable (default: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome)

## Optional Variables

- `JIRA_DASHBOARD_URL`: Custom dashboard URL (default: Board URL)

## Setup Instructions

1. Copy this template
2. Create a file named `.env` in the project root (optional if using defaults)
3. Fill in your actual values if different from defaults

## Login Command

Run the login command with:
```bash
npm run jira:login
```

This will:
1. Open the Jira board URL
2. Fill in your email address
3. Wait 10 seconds for fingerprint authentication
4. Detect success when the create button appears
5. Save session state for future use

