#rv-jira-automations

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

### Create Ticket Command

Create a Jira ticket interactively:

```bash
npm run jira:create-ticket
```

This command will:
1. Load the saved browser session (requires login first)
2. Navigate to the Jira board and click the "Create" button
3. Prompt you for ticket details:
   - Title
   - Description
   - Work Type
   - Components (if applicable)
   - Other fields as needed
4. Optionally use templates from `config/templates/teams/` or `config/templates/personal/`
5. Fill out the form automatically based on your inputs
6. Optionally create the ticket or keep the browser open for manual review

**Note:** You must run `npm run jira:login` first to establish a saved session before creating tickets.

## Templates Workflow

Templates help you quickly create tickets with predefined field values. Templates are organized into two folders:

- **`config/templates/teams/`** - Shared team templates (committed to git)
- **`config/templates/personal/`** - Personal templates (git-ignored, user-specific)

### Creating a Template

1. **Create a team template** (for sharing with the team):
   ```bash
   # Edit config/templates/teams/jira-templates.json
   ```

2. **Create a personal template** (for your own use):
   ```bash
   # Create config/templates/personal/jira-templates.json
   ```

3. **Template format**:
   ```json
   {
     "templates": {
       "My Template Name": {
         "workType": "Back-End Engineering",
         "components": ["Component Name"],
         "categoryReason": "CATEGORY 1 - Copy, color, image modifications",
         "riskAssessmentLevel": "MED",
         "typeOfRequest": "Planned",
         "taskClassification": "Tech Debt",
         "summaryPrefix": "BE | COMPONENT |",
         "descriptionForPartner": "",
         "storyPoints": "",
         "keyStakeholder": ""
       }
     }
   }
   ```

### Using Templates

1. Run the create ticket command:
   ```bash
   npm run jira:create-ticket
   ```

2. When prompted, select a template from the list (or press Enter to skip and enter manually)

3. The script will fill in the template values, then prompt you for:
   - Title (will be prefixed with `summaryPrefix` if defined)
   - Description
   - Any other required fields

4. Personal templates override team templates if they have the same name

### Recommended Workflow

1. **First time setup**: Create your personal template file:
   ```bash
   mkdir -p config/templates/personal
   cp config/templates/teams/jira-templates.json config/templates/personal/jira-templates.json
   ```

2. **Create tickets**: Use `npm run jira:create-ticket` and select from your templates

3. **Customize**: Edit your personal templates file to add your own shortcuts without affecting team templates

4. **Share templates**: Add useful templates to `config/templates/teams/jira-templates.json` so others can use them

## Session Persistence

The login script saves browser session state to `persistence/jira-session-state.json`. On subsequent runs, it will attempt to restore the saved session, avoiding the need to login again if the session is still valid.

## Project Structure

```
olwin-automations/
├── config/
│   ├── jira-config.js      # Jira configuration
│   ├── jira-options.json   # Saved field options
│   └── templates/
│       ├── teams/          # Shared team templates (git-committed)
│       │   └── jira-templates.json
│       └── personal/       # Personal templates (git-ignored)
│           └── jira-templates.json
├── src/
│   ├── jira-login.js       # Login command
│   └── create-jira-ticket.js # Ticket creation command
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
