import { chromium } from "playwright";
import { JIRA_CONFIG, validateConfig } from "../config/jira-config.js";
import { loadBrowserState } from "./jira-login.js";
import fs from "fs";
import path from "path";
import readline from "readline";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to prompt user for input
function promptUser(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Load saved options from JSON file
 */
function loadSavedOptions() {
  try {
    const optionsPath = path.join(process.cwd(), "config", "jira-options.json");
    if (fs.existsSync(optionsPath)) {
      const options = JSON.parse(fs.readFileSync(optionsPath, "utf8"));
      return options;
    }
  } catch (error) {
    console.warn("⚠️ Could not load saved options:", error.message);
  }
  return {};
}

/**
 * Save options to JSON file
 */
function saveOptions(options) {
  try {
    const optionsPath = path.join(process.cwd(), "config", "jira-options.json");
    fs.mkdirSync(path.dirname(optionsPath), { recursive: true });
    fs.writeFileSync(optionsPath, JSON.stringify(options, null, 2));
    console.log("💾 Saved options to config/jira-options.json");
  } catch (error) {
    console.warn("⚠️ Could not save options:", error.message);
  }
}

/**
 * Load templates from JSON file
 */
function loadTemplates() {
  try {
    const templatesPath = path.join(process.cwd(), "config", "jira-templates.json");
    if (fs.existsSync(templatesPath)) {
      const templates = JSON.parse(fs.readFileSync(templatesPath, "utf8"));
      return templates.templates || {};
    }
  } catch (error) {
    console.warn("⚠️ Could not load templates:", error.message);
  }
  return {};
}

/**
 * Select template at the start
 */
async function selectTemplate(templates) {
  const templateNames = Object.keys(templates);
  
  if (templateNames.length === 0) {
    console.log("ℹ️ No templates available. Proceeding with manual entry.");
    return null;
  }
  
  console.log("\n📋 Available Templates:");
  templateNames.forEach((name, index) => {
    const template = templates[name];
    console.log(`  ${index + 1}. ${name} - ${template.workType || 'N/A'} | ${template.components?.join(', ') || 'N/A'}`);
  });
  
  const choice = await promptUser(`\nSelect template (1-${templateNames.length}, or press Enter to skip): `);
  
  if (choice.trim()) {
    const selectedIndex = parseInt(choice) - 1;
    if (selectedIndex >= 0 && selectedIndex < templateNames.length) {
      const templateName = templateNames[selectedIndex];
      console.log(`✅ Selected template: ${templateName}`);
      return { name: templateName, ...templates[templateName] };
    }
  }
  
  return null;
}

/**
 * Get available options from a select/dropdown field
 */
async function getSelectOptions(page, fieldSelector) {
  try {
    await page.waitForSelector(fieldSelector, { timeout: 5000 });
    const options = await page.evaluate((selector) => {
      const select = document.querySelector(selector);
      if (!select) return [];
      
      const opts = Array.from(select.options || select.querySelectorAll('option'));
      return opts.map((opt, index) => ({
        index: index + 1,
        value: opt.value,
        text: opt.textContent.trim(),
      })).filter(opt => opt.value && opt.text);
    }, fieldSelector);
    
    return options;
  } catch (error) {
    console.warn(`⚠️ Could not get options for ${fieldSelector}:`, error.message);
    return [];
  }
}

/**
 * Get available options from an autocomplete/combobox field
 */
async function getAutocompleteOptions(page, fieldSelector) {
  try {
    await page.waitForSelector(fieldSelector, { timeout: 5000 });
    
    // Click to open dropdown
    await page.click(fieldSelector);
    await page.waitForTimeout(500);
    
    // Get listbox ID from aria-controls attribute
    const listboxId = await page.evaluate((selector) => {
      const input = document.querySelector(selector);
      return input ? input.getAttribute('aria-controls') : null;
    }, fieldSelector).catch(() => null);
    
    // Wait for listbox to appear
    const listboxSelector = listboxId ? `#${listboxId}` : '[role="listbox"]';
    await page.waitForSelector(listboxSelector, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    
    // Get options from listbox
    const options = await page.evaluate((selector) => {
      const listbox = document.querySelector(selector);
      if (!listbox) return [];
      
      // First try to find option elements
      const optionElements = listbox.querySelectorAll('[role="option"]');
      if (optionElements.length > 0) {
        return Array.from(optionElements).map((opt, index) => ({
          index: index + 1,
          text: opt.textContent?.trim() || '',
          value: opt.getAttribute('data-value') || opt.textContent?.trim(),
        })).filter(opt => opt.text);
      }
      
      // If no option elements, try to get text content (for react-select style)
      // The text might be space-separated or newline-separated
      const text = listbox.textContent?.trim() || '';
      if (text) {
        // Split by whitespace sequences (multiple spaces or newlines)
        // Items appear to be single words or phrases
        const items = text.split(/\s+/).filter(item => item.trim() && item.length > 0);
        return items.map((item, index) => ({
          index: index + 1,
          text: item.trim(),
          value: item.trim(),
        })).filter(opt => opt.text);
      }
      
      return [];
    }, listboxSelector);
    
    return options;
  } catch (error) {
    console.warn(`⚠️ Could not get autocomplete options:`, error.message);
    return [];
  }
}

/**
 * Select option from autocomplete field by index
 */
async function selectAutocompleteOption(page, fieldSelector, selectedIndex) {
  try {
    // Click field to open dropdown
    await page.click(fieldSelector);
    await page.waitForTimeout(500);
    
    // Get listbox ID from aria-controls
    const listboxId = await page.evaluate((selector) => {
      const input = document.querySelector(selector);
      return input ? input.getAttribute('aria-controls') : null;
    }, fieldSelector).catch(() => null);
    
    // Wait for listbox
    const listboxSelector = listboxId ? `#${listboxId}` : '[role="listbox"]';
    await page.waitForSelector(listboxSelector, { timeout: 3000 });
    await page.waitForTimeout(300);
    
    // Use keyboard navigation for react-select components
    // Focus the input field first
    await page.focus(fieldSelector);
    await page.waitForTimeout(200);
    
    // Navigate to the selected option using ArrowDown
    // Start from first option (already focused)
    for (let i = 0; i < selectedIndex; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(100);
    }
    
    // Press Enter to select
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    return true;
  } catch (error) {
    console.warn(`⚠️ Could not select autocomplete option:`, error.message);
    return false;
  }
}

/**
 * Create a Jira ticket by opening the board and clicking the create button
 */
async function createJiraTicket() {
  console.log("🚀 Starting JIRA ticket creation...");
  let browser = null;
  let page = null;
  let context = null;

  try {
    // Validate configuration
    validateConfig();

    // Load saved browser state if available
    const savedState = loadBrowserState();
    
    if (!savedState) {
      console.error("❌ No saved browser state found. Please run 'npm run jira:login' first.");
      return;
    }

    // Create browser with saved state
    browser = await chromium.launch({
      executablePath: JIRA_CONFIG.chromePath,
      headless: false,
      slowMo: JIRA_CONFIG.browser.slowMo,
      args: JIRA_CONFIG.browser.args || [],
    });

    // Restore session from saved state
    context = await browser.newContext({ storageState: savedState });
    console.log("✅ Restored session from saved state");

    page = await context.newPage();
    await page.setViewportSize(JIRA_CONFIG.browser.viewport);

    // Navigate to the Jira board URL
    console.log("📱 Navigating to Jira board...");
    await page.goto(JIRA_CONFIG.dashboardUrl, {
      waitUntil: "domcontentloaded",
      timeout: JIRA_CONFIG.timeouts.navigation,
    });

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Look for and click the create button
    console.log("🔍 Looking for create button...");
    // Try the specific data-testid first, then fallback
    let createButton = page.locator(JIRA_CONFIG.selectors.createButton).first();
    const isVisible = await createButton.isVisible().catch(() => false);
    
    if (!isVisible) {
      console.log("⚠️ Primary create button not found, trying fallback...");
      createButton = page.locator(JIRA_CONFIG.selectors.createButtonFallback).first();
    }
    
    // Wait for create button to be visible
    await createButton.waitFor({ 
      state: "visible", 
      timeout: JIRA_CONFIG.timeouts.element 
    });

    console.log("👆 Clicking create button...");
    await createButton.click();

    // Wait for create dialog/modal to appear
    console.log("⏳ Waiting for create dialog to appear...");
    await page.waitForTimeout(3000);

    // Wait for the form to be visible
    const formVisible = await page.locator('form, [role="dialog"] form, .create-issue-dialog').isVisible().catch(() => false);
    if (!formVisible) {
      console.log("⚠️ Create form not visible yet, waiting...");
      await page.waitForTimeout(2000);
    }

    console.log("✅ Create dialog opened successfully!");

    // Load templates and prompt user to select one
    const templates = loadTemplates();
    const selectedTemplate = await selectTemplate(templates);

    // Load saved options
    const savedOptions = loadSavedOptions();
    const optionsToSave = { ...savedOptions };

    // Get default stakeholder from .env
    const defaultStakeholder = process.env.JIRA_DEFAULT_STAKEHOLDER || "Oka Lwin";

    // 1. Handle Work Type field (autocomplete/combobox)
    console.log("\n📋 Work Type Selection:");
    // Find by label text, then get the associated input via 'for' attribute
    const workTypeSelector = 'label:has-text("Work type"), label:has-text("Work type*")';
    const workTypeLabel = page.locator(workTypeSelector).first();
    
    const isLabelVisible = await workTypeLabel.isVisible().catch(() => false);
    let workTypeInput = null;
    
    if (isLabelVisible) {
      // Get the 'for' attribute to find the associated input
      const forAttribute = await workTypeLabel.getAttribute('for').catch(() => null);
      if (forAttribute) {
        workTypeInput = page.locator(`#${forAttribute}`).first();
      } else {
        // Fallback: find input near the label
        workTypeInput = page.locator(workTypeSelector + ' ~ input, ' + workTypeSelector + ' + input').first();
      }
    }
    
    // Fallback selectors if label approach doesn't work
    if (!workTypeInput || !(await workTypeInput.isVisible().catch(() => false))) {
      workTypeInput = page.locator('#type-picker-_rlv_, input[id*="type-picker"], input[role="combobox"][aria-haspopup="listbox"]').first();
    }
    
    const isWorkTypeVisible = await workTypeInput.isVisible().catch(() => false);
    if (isWorkTypeVisible) {
      const workTypeInputId = await workTypeInput.getAttribute('id').catch(() => '');
      const selectorToUse = workTypeInputId ? `#${workTypeInputId}` : workTypeSelector;
      
      // Use saved options if available, otherwise fetch
      let workTypeOptions = [];
      if (savedOptions.workTypes && savedOptions.workTypes.length > 0) {
        console.log("📂 Using saved work type options");
        workTypeOptions = savedOptions.workTypes.map((text, index) => ({
          index: index + 1,
          text: text,
          value: text,
        }));
      } else {
        workTypeOptions = await getAutocompleteOptions(page, selectorToUse);
        if (workTypeOptions.length > 0) {
          optionsToSave.workTypes = workTypeOptions.map(opt => opt.text);
        }
      }
      
      if (workTypeOptions.length > 0) {
        console.log("\nAvailable Work Types:");
        workTypeOptions.forEach(opt => {
          console.log(`  ${opt.index}. ${opt.text}`);
        });
        
        // Use template value if available
        let selectedWorkType = null;
        if (selectedTemplate && selectedTemplate.workType) {
          const templateWorkTypeIndex = workTypeOptions.findIndex(opt => opt.text === selectedTemplate.workType);
          if (templateWorkTypeIndex >= 0) {
            selectedWorkType = workTypeOptions[templateWorkTypeIndex];
            console.log(`📋 Using template work type: ${selectedWorkType.text}`);
          }
        }
        
        if (!selectedWorkType) {
          const workTypeChoice = await promptUser(`\nSelect work type (1-${workTypeOptions.length}): `);
          const selectedIndex = parseInt(workTypeChoice) - 1;
          
          if (selectedIndex >= 0 && selectedIndex < workTypeOptions.length) {
            selectedWorkType = workTypeOptions[selectedIndex];
          } else {
            console.log("⚠️ Invalid selection, skipping work type");
            selectedWorkType = null;
          }
        }
        
        if (selectedWorkType) {
          // Click to focus the field
          await workTypeInput.click();
          await page.waitForTimeout(200);
          
          // Clear and type the selected work type text
          await workTypeInput.fill(selectedWorkType.text);
          await page.waitForTimeout(500);
          
          // Wait for autocomplete dropdown to appear and select the match
          const listboxVisible = await page.locator('[role="listbox"]').isVisible({ timeout: 2000 }).catch(() => false);
          if (listboxVisible) {
            // Press Enter to select the matching option
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);
          }
          
          console.log(`✅ Selected work type: ${selectedWorkType.text}`);
        }
      } else {
        console.log("⚠️ No work type options found");
      }
    } else {
      console.log("⚠️ Work type field not found");
    }

    // 2. Handle Summary field
    console.log("\n📝 Summary:");
    const summarySelector = 'input[name*="summary"], input[id*="summary"], textarea[name*="summary"], textarea[id*="summary"], label:has-text("Summary") + input, label:has-text("Summary*") + input';
    const summaryInput = page.locator(summarySelector).first();
    
    const isSummaryVisible = await summaryInput.isVisible().catch(() => false);
    if (isSummaryVisible) {
      // Get current summary value
      const currentSummary = await summaryInput.inputValue().catch(() => '');
      
      // Build summary with prefix from template if available
      let summaryPrefix = '';
      if (selectedTemplate && selectedTemplate.summaryPrefix) {
        summaryPrefix = selectedTemplate.summaryPrefix;
      }
      
      // If there's a prefix, show it to the user
      if (summaryPrefix) {
        console.log(`📋 Template summary prefix: ${summaryPrefix}`);
      }
      
      if (currentSummary) {
        console.log(`Current summary: ${currentSummary}`);
      }
      
      let promptText = "Enter summary";
      if (summaryPrefix) {
        promptText += ` (prefix: ${summaryPrefix})`;
      }
      promptText += " (or press Enter to keep current): ";
      
      const newSummary = await promptUser(promptText);
      
      // Combine prefix with user input
      let finalSummary = '';
      if (newSummary.trim()) {
        finalSummary = summaryPrefix ? `${summaryPrefix} ${newSummary.trim()}` : newSummary.trim();
      } else if (currentSummary) {
        finalSummary = currentSummary;
      } else if (summaryPrefix) {
        // If only prefix provided, use it
        finalSummary = summaryPrefix.trim();
      }
      
      if (finalSummary) {
        // Clear and fill summary
        await summaryInput.click();
        await summaryInput.fill('');
        await summaryInput.fill(finalSummary);
        console.log(`✅ Summary updated: ${finalSummary}`);
      } else {
        console.log("✅ Skipping summary");
      }
    } else {
      console.log("⚠️ Summary field not found");
    }

    // 3. Handle Components field (autocomplete/combobox)
    console.log("\n🧩 Components:");
    const componentSelector = '#components-field, input[data-testid*="components-field"], input[id*="component"][role="combobox"]';
    const componentField = page.locator(componentSelector).first();
    
    const isComponentVisible = await componentField.isVisible().catch(() => false);
    if (isComponentVisible) {
      // Use saved options if available, otherwise fetch
      let componentOptions = [];
      if (savedOptions.components && savedOptions.components.length > 0) {
        console.log("📂 Using saved component options");
        componentOptions = savedOptions.components.map((text, index) => ({
          index: index + 1,
          text: text,
          value: text,
        }));
      } else {
        componentOptions = await getAutocompleteOptions(page, componentSelector);
        if (componentOptions.length > 0) {
          optionsToSave.components = componentOptions.map(opt => opt.text);
        }
      }
      
      if (componentOptions.length > 0) {
        console.log("\nAvailable Components:");
        componentOptions.forEach(opt => {
          console.log(`  ${opt.index}. ${opt.text}`);
        });
        
        // Use template values if available
        let selectedComponents = [];
        if (selectedTemplate && selectedTemplate.components && Array.isArray(selectedTemplate.components)) {
          selectedComponents = selectedTemplate.components.filter(templateComp => 
            componentOptions.some(opt => opt.text === templateComp)
          );
          if (selectedComponents.length > 0) {
            console.log(`📋 Using template components: ${selectedComponents.join(', ')}`);
          }
        }
        
        if (selectedComponents.length === 0) {
          const componentChoice = await promptUser(`\nSelect component (1-${componentOptions.length}, or press Enter to skip): `);
          
          if (componentChoice.trim()) {
            const selectedIndex = parseInt(componentChoice) - 1;
            if (selectedIndex >= 0 && selectedIndex < componentOptions.length) {
              selectedComponents = [componentOptions[selectedIndex].text];
            } else {
              console.log("⚠️ Invalid selection, skipping component");
            }
          }
        }
        
        // Fill components
        for (const componentName of selectedComponents) {
          await componentField.click();
          await page.waitForTimeout(200);
          await componentField.fill(componentName);
          await page.waitForTimeout(500);
          
          const listboxVisible = await page.locator('[role="listbox"]').isVisible({ timeout: 2000 }).catch(() => false);
          if (listboxVisible) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);
          }
          console.log(`✅ Selected component: ${componentName}`);
        }
      } else {
        console.log("⚠️ No component options found");
      }
    } else {
      console.log("⚠️ Components field not found");
    }

    console.log("\n✅ Form filled! Continuing with field entry...");

    // 4. Handle Description for Partner field
    console.log("\n📝 Description for Partner:");
    const partnerDescSelector = '#customfield_10847-field, textarea[name="customfield_10847"]';
    const partnerDescField = page.locator(partnerDescSelector).first();
    
    const isPartnerDescVisible = await partnerDescField.isVisible().catch(() => false);
    if (isPartnerDescVisible) {
      // Use template value if available
      let partnerDesc = '';
      if (selectedTemplate && selectedTemplate.descriptionForPartner) {
        partnerDesc = selectedTemplate.descriptionForPartner;
        console.log(`📋 Using template description: ${partnerDesc}`);
      }
      
      const userInput = await promptUser(`Enter description for partner${partnerDesc ? ` (template: ${partnerDesc})` : ''} (or press Enter to skip): `);
      
      if (userInput.trim()) {
        partnerDesc = userInput.trim();
      }
      
      if (partnerDesc) {
        await partnerDescField.click();
        await partnerDescField.fill(partnerDesc);
        console.log(`✅ Entered description for partner`);
      } else {
        console.log("✅ Skipping description for partner");
      }
    } else {
      console.log("⚠️ Description for partner field not found");
    }

    // 5. Handle Category Reason field (autocomplete)
    console.log("\n📋 Category Reason:");
    const categoryReasonSelector = '#customfield_10849-field, input[id*="customfield_10849"]';
    const categoryReasonField = page.locator(categoryReasonSelector).first();
    
    const isCategoryReasonVisible = await categoryReasonField.isVisible().catch(() => false);
    if (isCategoryReasonVisible) {
      // Use saved options if available, otherwise fetch
      let categoryReasonOptions = [];
      if (savedOptions.categoryReasons && savedOptions.categoryReasons.length > 0) {
        console.log("📂 Using saved category reason options");
        categoryReasonOptions = savedOptions.categoryReasons.map((text, index) => ({
          index: index + 1,
          text: text,
          value: text,
        }));
      } else {
        categoryReasonOptions = await getAutocompleteOptions(page, categoryReasonSelector);
        if (categoryReasonOptions.length > 0) {
          optionsToSave.categoryReasons = categoryReasonOptions.map(opt => opt.text);
        }
      }
      
      if (categoryReasonOptions.length > 0) {
        console.log("\nAvailable Category Reasons:");
        categoryReasonOptions.forEach(opt => {
          console.log(`  ${opt.index}. ${opt.text}`);
        });
        
        // Use template value if available
        let selectedCategoryReason = null;
        if (selectedTemplate && selectedTemplate.categoryReason) {
          const templateIndex = categoryReasonOptions.findIndex(opt => opt.text === selectedTemplate.categoryReason);
          if (templateIndex >= 0) {
            selectedCategoryReason = categoryReasonOptions[templateIndex];
            console.log(`📋 Using template category reason: ${selectedCategoryReason.text}`);
          }
        }
        
        if (!selectedCategoryReason) {
          const categoryReasonChoice = await promptUser(`\nSelect category reason (1-${categoryReasonOptions.length}, or press Enter to skip): `);
          
          if (categoryReasonChoice.trim()) {
            const selectedIndex = parseInt(categoryReasonChoice) - 1;
            if (selectedIndex >= 0 && selectedIndex < categoryReasonOptions.length) {
              selectedCategoryReason = categoryReasonOptions[selectedIndex];
            }
          }
        }
        
        if (selectedCategoryReason) {
          await categoryReasonField.click();
          await page.waitForTimeout(200);
          await categoryReasonField.fill(selectedCategoryReason.text);
          await page.waitForTimeout(500);
          
          const listboxVisible = await page.locator('[role="listbox"]').isVisible({ timeout: 2000 }).catch(() => false);
          if (listboxVisible) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);
          }
          
          console.log(`✅ Selected category reason: ${selectedCategoryReason.text}`);
        } else {
          console.log("✅ Skipping category reason");
        }
      } else {
        console.log("⚠️ No category reason options found");
      }
    } else {
      console.log("⚠️ Category reason field not found");
    }

    // 6. Handle Risk Assessment Level field
    console.log("\n⚠️ Risk Assessment Level:");
    const riskAssessmentSelector = '[class*="customfield_10850"] input[role="combobox"], input[id*="customfield_10850"], select[id*="customfield_10850"]';
    const riskAssessmentField = page.locator(riskAssessmentSelector).first();
    
    const isRiskAssessmentVisible = await riskAssessmentField.isVisible().catch(() => false);
    if (isRiskAssessmentVisible) {
      // Use saved options if available, otherwise fetch
      let riskAssessmentOptions = [];
      if (savedOptions.riskAssessmentLevels && savedOptions.riskAssessmentLevels.length > 0) {
        console.log("📂 Using saved risk assessment level options");
        riskAssessmentOptions = savedOptions.riskAssessmentLevels.map((text, index) => ({
          index: index + 1,
          text: text,
          value: text,
        }));
      } else {
        riskAssessmentOptions = await getAutocompleteOptions(page, riskAssessmentSelector);
        if (riskAssessmentOptions.length > 0) {
          optionsToSave.riskAssessmentLevels = riskAssessmentOptions.map(opt => opt.text);
        }
      }
      
      if (riskAssessmentOptions.length > 0) {
        console.log("\nAvailable Risk Assessment Levels:");
        riskAssessmentOptions.forEach(opt => {
          console.log(`  ${opt.index}. ${opt.text}`);
        });
        
        // Use template value if available
        let selectedRiskAssessment = null;
        if (selectedTemplate && selectedTemplate.riskAssessmentLevel) {
          const templateIndex = riskAssessmentOptions.findIndex(opt => opt.text === selectedTemplate.riskAssessmentLevel);
          if (templateIndex >= 0) {
            selectedRiskAssessment = riskAssessmentOptions[templateIndex];
            console.log(`📋 Using template risk assessment level: ${selectedRiskAssessment.text}`);
          }
        }
        
        if (!selectedRiskAssessment) {
          const riskAssessmentChoice = await promptUser(`\nSelect risk assessment level (1-${riskAssessmentOptions.length}, or press Enter to skip): `);
          
          if (riskAssessmentChoice.trim()) {
            const selectedIndex = parseInt(riskAssessmentChoice) - 1;
            if (selectedIndex >= 0 && selectedIndex < riskAssessmentOptions.length) {
              selectedRiskAssessment = riskAssessmentOptions[selectedIndex];
            }
          }
        }
        
        if (selectedRiskAssessment) {
          await riskAssessmentField.click();
          await page.waitForTimeout(200);
          await riskAssessmentField.fill(selectedRiskAssessment.text);
          await page.waitForTimeout(500);
          
          const listboxVisible = await page.locator('[role="listbox"]').isVisible({ timeout: 2000 }).catch(() => false);
          if (listboxVisible) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);
          }
          
          console.log(`✅ Selected risk assessment level: ${selectedRiskAssessment.text}`);
        } else {
          console.log("✅ Skipping risk assessment level");
        }
      } else {
        console.log("⚠️ No risk assessment level options found");
      }
    } else {
      console.log("⚠️ Risk assessment level field not found");
    }

    // 7. Handle Story Points field
    console.log("\n📊 Story Points:");
    const storyPointsSelector = '#customfield_10024-field, input[name="customfield_10024"], input[id*="customfield_10024"]';
    const storyPointsField = page.locator(storyPointsSelector).first();
    
    const isStoryPointsVisible = await storyPointsField.isVisible().catch(() => false);
    if (isStoryPointsVisible) {
      // Use template value if available
      let storyPoints = '';
      if (selectedTemplate && selectedTemplate.storyPoints) {
        storyPoints = selectedTemplate.storyPoints;
        console.log(`📋 Using template story points: ${storyPoints}`);
      }
      
      const userInput = await promptUser(`Enter story points${storyPoints ? ` (template: ${storyPoints})` : ''} (or press Enter to skip): `);
      
      if (userInput.trim()) {
        storyPoints = userInput.trim();
      }
      
      if (storyPoints) {
        await storyPointsField.click();
        await storyPointsField.fill(storyPoints);
        console.log(`✅ Entered story points: ${storyPoints}`);
      } else {
        console.log("✅ Skipping story points");
      }
    } else {
      console.log("⚠️ Story points field not found");
    }

    // 8. Handle Type of Request field (autocomplete)
    console.log("\n📋 Type of Request:");
    const typeOfRequestSelector = '#customfield_10775-field, input[id*="customfield_10775"]';
    const typeOfRequestField = page.locator(typeOfRequestSelector).first();
    
    const isTypeOfRequestVisible = await typeOfRequestField.isVisible().catch(() => false);
    if (isTypeOfRequestVisible) {
      // Use saved options if available, otherwise fetch
      let typeOfRequestOptions = [];
      if (savedOptions.typeOfRequest && savedOptions.typeOfRequest.length > 0) {
        console.log("📂 Using saved type of request options");
        typeOfRequestOptions = savedOptions.typeOfRequest.map((text, index) => ({
          index: index + 1,
          text: text,
          value: text,
        }));
      } else {
        typeOfRequestOptions = await getAutocompleteOptions(page, typeOfRequestSelector);
        if (typeOfRequestOptions.length > 0) {
          optionsToSave.typeOfRequest = typeOfRequestOptions.map(opt => opt.text);
        }
      }
      
      if (typeOfRequestOptions.length > 0) {
        console.log("\nAvailable Types of Request:");
        typeOfRequestOptions.forEach(opt => {
          console.log(`  ${opt.index}. ${opt.text}`);
        });
        
        // Use template value if available
        let selectedTypeOfRequest = null;
        if (selectedTemplate && selectedTemplate.typeOfRequest) {
          const templateIndex = typeOfRequestOptions.findIndex(opt => opt.text === selectedTemplate.typeOfRequest);
          if (templateIndex >= 0) {
            selectedTypeOfRequest = typeOfRequestOptions[templateIndex];
            console.log(`📋 Using template type of request: ${selectedTypeOfRequest.text}`);
          }
        }
        
        if (!selectedTypeOfRequest) {
          const typeOfRequestChoice = await promptUser(`\nSelect type of request (1-${typeOfRequestOptions.length}, or press Enter to skip): `);
          
          if (typeOfRequestChoice.trim()) {
            const selectedIndex = parseInt(typeOfRequestChoice) - 1;
            if (selectedIndex >= 0 && selectedIndex < typeOfRequestOptions.length) {
              selectedTypeOfRequest = typeOfRequestOptions[selectedIndex];
            }
          }
        }
        
        if (selectedTypeOfRequest) {
          await typeOfRequestField.click();
          await page.waitForTimeout(200);
          await typeOfRequestField.fill(selectedTypeOfRequest.text);
          await page.waitForTimeout(500);
          
          const listboxVisible = await page.locator('[role="listbox"]').isVisible({ timeout: 2000 }).catch(() => false);
          if (listboxVisible) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);
          }
          
          console.log(`✅ Selected type of request: ${selectedTypeOfRequest.text}`);
        } else {
          console.log("✅ Skipping type of request");
        }
      } else {
        console.log("⚠️ No type of request options found");
      }
    } else {
      console.log("⚠️ Type of request field not found");
    }

    // 9. Handle Task Classification field
    console.log("\n📋 Task Classification:");
    const taskClassificationSelector = '[class*="customfield_10082"] input[role="combobox"], input[id*="customfield_10082"], select[id*="customfield_10082"]';
    const taskClassificationField = page.locator(taskClassificationSelector).first();
    
    const isTaskClassificationVisible = await taskClassificationField.isVisible().catch(() => false);
    if (isTaskClassificationVisible) {
      // Use saved options if available, otherwise fetch
      let taskClassificationOptions = [];
      if (savedOptions.taskClassifications && savedOptions.taskClassifications.length > 0) {
        console.log("📂 Using saved task classification options");
        taskClassificationOptions = savedOptions.taskClassifications.map((text, index) => ({
          index: index + 1,
          text: text,
          value: text,
        }));
      } else {
        taskClassificationOptions = await getAutocompleteOptions(page, taskClassificationSelector);
        if (taskClassificationOptions.length > 0) {
          optionsToSave.taskClassifications = taskClassificationOptions.map(opt => opt.text);
        }
      }
      
      if (taskClassificationOptions.length > 0) {
        console.log("\nAvailable Task Classifications:");
        taskClassificationOptions.forEach(opt => {
          console.log(`  ${opt.index}. ${opt.text}`);
        });
        
        // Use template value if available
        let selectedTaskClassification = null;
        if (selectedTemplate && selectedTemplate.taskClassification) {
          const templateIndex = taskClassificationOptions.findIndex(opt => opt.text === selectedTemplate.taskClassification);
          if (templateIndex >= 0) {
            selectedTaskClassification = taskClassificationOptions[templateIndex];
            console.log(`📋 Using template task classification: ${selectedTaskClassification.text}`);
          }
        }
        
        if (!selectedTaskClassification) {
          const taskClassificationChoice = await promptUser(`\nSelect task classification (1-${taskClassificationOptions.length}, or press Enter to skip): `);
          
          if (taskClassificationChoice.trim()) {
            const selectedIndex = parseInt(taskClassificationChoice) - 1;
            if (selectedIndex >= 0 && selectedIndex < taskClassificationOptions.length) {
              selectedTaskClassification = taskClassificationOptions[selectedIndex];
            }
          }
        }
        
        if (selectedTaskClassification) {
          await taskClassificationField.click();
          await page.waitForTimeout(200);
          await taskClassificationField.fill(selectedTaskClassification.text);
          await page.waitForTimeout(500);
          
          const listboxVisible = await page.locator('[role="listbox"]').isVisible({ timeout: 2000 }).catch(() => false);
          if (listboxVisible) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);
          }
          
          console.log(`✅ Selected task classification: ${selectedTaskClassification.text}`);
        } else {
          console.log("✅ Skipping task classification");
        }
      } else {
        console.log("⚠️ No task classification options found");
      }
    } else {
      console.log("⚠️ Task classification field not found");
    }

    // 10. Handle Key Stakeholder field
    console.log("\n👤 Key Stakeholder:");
    const keyStakeholderSelector = '[class*="fabric-user-picker"] input, input[aria-label*="stakeholder"], input[aria-label*="Stakeholder"], input[id*="stakeholder"]';
    const keyStakeholderField = page.locator(keyStakeholderSelector).first();
    
    const isKeyStakeholderVisible = await keyStakeholderField.isVisible().catch(() => false);
    if (isKeyStakeholderVisible) {
      // Use template value if available, otherwise use default from .env
      let stakeholderName = '';
      if (selectedTemplate && selectedTemplate.keyStakeholder) {
        stakeholderName = selectedTemplate.keyStakeholder;
        console.log(`📋 Using template stakeholder: ${stakeholderName}`);
      } else {
        stakeholderName = defaultStakeholder;
        console.log(`📋 Using default stakeholder from .env: ${stakeholderName}`);
      }
      
      // Allow user to override
      const userInput = await promptUser(`Enter key stakeholder name (default: ${stakeholderName}, or press Enter to use default): `);
      
      if (userInput.trim()) {
        stakeholderName = userInput.trim();
      }
      
      if (stakeholderName) {
        await keyStakeholderField.click();
        await page.waitForTimeout(200);
        await keyStakeholderField.fill(stakeholderName);
        await page.waitForTimeout(500);
        
        // Wait for autocomplete and select
        const listboxVisible = await page.locator('[role="listbox"]').isVisible({ timeout: 2000 }).catch(() => false);
        if (listboxVisible) {
          await page.keyboard.press('Enter');
          await page.waitForTimeout(300);
          console.log(`✅ Set key stakeholder: ${stakeholderName}`);
        } else {
          console.log(`✅ Entered key stakeholder: ${stakeholderName}`);
        }
      } else {
        console.log("✅ Skipping key stakeholder");
      }
    } else {
      console.log("⚠️ Key stakeholder field not found");
    }

    // Save all collected options to file
    if (Object.keys(optionsToSave).length > 0) {
      saveOptions(optionsToSave);
    }

    // Prompt user to create the ticket
    console.log("\n🎯 All fields have been filled!");
    const createChoice = await promptUser("Do you want to create the ticket now? (yes/no, default: no): ");
    
    const shouldCreate = createChoice.trim().toLowerCase() === 'yes' || createChoice.trim().toLowerCase() === 'y';
    
    if (shouldCreate) {
      console.log("🚀 Creating ticket...");
      
      // Find and click the Create button
      const createButtonSelector = 'button[data-testid="issue-create.common.ui.footer.create-button"], button[form="issue-create.ui.modal.create-form"][type="submit"]';
      const createButton = page.locator(createButtonSelector).first();
      
      try {
        // Wait for the button to be visible
        await createButton.waitFor({ 
          state: 'visible', 
          timeout: JIRA_CONFIG.timeouts.element 
        });
        
        // Click the Create button
        await createButton.click();
        console.log("✅ Create button clicked!");
        
        // Wait a moment for the ticket to be created
        await page.waitForTimeout(2000);
        
        // Check if we navigated away (ticket created) or if there are errors
        const currentUrl = page.url();
        if (currentUrl.includes('/browse/')) {
          console.log("✅ Ticket created successfully!");
          console.log(`📍 Ticket URL: ${currentUrl}`);
        } else {
          console.log("⚠️ Ticket creation may still be processing...");
          console.log("💡 Browser will remain open for you to verify.");
        }
      } catch (error) {
        console.error("❌ Error clicking Create button:", error.message);
        console.log("💡 Browser will remain open for you to manually create the ticket.");
      }
    } else {
      console.log("⏸️ Ticket creation skipped.");
      console.log("💡 Browser will remain open for you to review and create manually.");
    }

    // Keep browser open for a short time for user to see the result
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

  } catch (error) {
    console.error("❌ Error during ticket creation:", error.message);

    // Take a screenshot for debugging
    if (page) {
      try {
        const screenshotPath = path.join(process.cwd(), "screenshots", `ticket-creation-error-${Date.now()}.png`);
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath });
        console.log(`📸 Error screenshot saved as ${screenshotPath}`);
      } catch (screenshotError) {
        console.warn("⚠️ Could not save screenshot:", screenshotError.message);
      }
    }
  } finally {
    rl.close();
    console.log("🏁 Ticket creation process completed.");
    // Browser will remain open - user can close manually
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Run the script
createJiraTicket().catch(console.error);

