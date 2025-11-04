# olwin-automations

Automation scripts using Playwright for Red Ventures Jira.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Install Playwright browsers:
```bash
npm run install-browsers
```

3. (Optional) Create a `.env` file for custom configuration:
```bash
cp ENV_TEMPLATE.md .env
# Edit .env with your values
```

## Usage

### Login Command

Login to Red Ventures Jira with fingerprint authentication:

```bash
npm run jira:login
```

This command will:
1. Open the Jira board URL: `https://redventures.atlassian.net/jira/software/c/projects/FRONT/boards/3839?assignee=712020%3A417e205f-b507-4575-8bf4-ddaf69b31de0`
2. Fill in `olwin@redventures.com` as the username
3. Press Enter
4. Wait 10 seconds for you to provide fingerprint authentication
5. Detect success when the "Create" button appears
6. Save session state for future use

## Session Persistence

The login script saves browser session state to `persistence/jira-session-state.json`. On subsequent runs, it will attempt to restore the saved session, avoiding the need to login again if the session is still valid.

## Project Structure

```
olwin-automations/
├── config/
│   └── jira-config.js      # Jira configuration
├── src/
│   └── jira-login.js       # Login command
├── persistence/             # Saved session states
├── screenshots/             # Error screenshots
├── package.json
├── playwright.config.js
└── README.md
```

## Configuration

Default configuration is set in `config/jira-config.js`. You can override values using environment variables:

- `JIRA_EMAIL`: Email address (default: olwin@redventures.com)
- `JIRA_BASE_URL`: Jira base URL (default: https://redventures.atlassian.net)
- `CHROME_PATH`: Path to Chrome executable

See `ENV_TEMPLATE.md` for more details.
