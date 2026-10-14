import testmu, { resolveVar, setVar } from '@testmuai/playwright-bindings';
import { expect } from '@playwright/test';

testmu.configure({
  "build": "1b9099cd-ecff-43e2-9a63-41261d370a03",
  "name": "Load and Verify Full Body Starter Plan",
  "tcId": "TC-182",
  "network": (process.env.NETWORK ?? "false").toLowerCase() === "true",
  "autoHealVersion": "AH2",
  "defaultActionTimeoutMs": 10000,
  "defaultNavigationTimeoutMs": 60000,
  "kaneRunV4": true
});

testmu.test("Load and Verify Full Body Starter Plan", async (page) => {
  let element_0, element_1, element_2, element_3;
  await testmu.step("Navigate to http://localhost:8080/", { instructionId: "72f0891b-db4d-45d5-a3a9-6a17b60abde5" }, async () => {
    await page.goto("http://localhost:8080/");
  });
  
  await testmu.step("Clicking Continue without account", { instructionId: "561ecb20-fc51-46ae-a858-cd0c7534f49c" }, async () => {
    element_0 = page.locator("internal:role=button[name=\"Continue without account\"i]");
    await element_0.click();
  });
  
  await testmu.step("Checking whether the Load starter plan button is visible", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("load_starter_plan_button_visible", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {16: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(16) !== null && !el(16).hidden && el(16).getAttribute('aria-hidden') !== 'true');\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:role=button[name=\"Load starter plan\"i]"], query: "whether the Load starter plan button is present on the home screen", expectedValue: "true", needsUnitConversion: false, operator: "equals", transforms: [], condition: "The home screen shows a \"Load starter plan\" button." }));
  });
  
  await testmu.step("Checking whether the guest mode notice is visible", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("guest_mode_notice_visible", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {24: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(24) !== null && el(24).textContent.includes('Guest mode: your data lives only in this browser.') && !el(24).hidden && el(24).getAttribute('aria-hidden') !== 'true');\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:role=button[name=\"Guest mode: your data lives\"i]"], query: "whether the guest mode notice is present on the home screen", expectedValue: "true", needsUnitConversion: false, operator: "equals", transforms: [], condition: "The home screen shows the notice \"Guest mode: your data lives only in this browser.\"" }));
  });
  
  await testmu.step("Assertion check", { instructionId: "24dd8d20-a4e3-48c9-8243-e3a8c68f1cf8" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {"operator": ["equals"], "assertion_operands": [], "left_operand": null, "right_operand": null, "operands": [], "sub_results": [{"description": "The home screen shows a \"Load starter plan\" button.", "passed": true, "operator": "equals", "transforms": [], "json_path": null, "expected": "true", "extracted_value": "{{load_starter_plan_button_visible}}", "store_key": "load_starter_plan_button_visible", "variable_refs": {"{{load_starter_plan_button_visible}}": "true"}}, {"description": "The home screen shows the notice \"Guest mode: your data lives only in this browser.\"", "passed": true, "operator": "equals", "transforms": [], "json_path": null, "expected": "true", "extracted_value": "{{guest_mode_notice_visible}}", "store_key": "guest_mode_notice_visible", "variable_refs": {"{{guest_mode_notice_visible}}": "true"}}], "sub_checks": [{"description": "The home screen shows a \"Load starter plan\" button.", "store_key": "load_starter_plan_button_visible", "expected_value": "true", "extracted_value": "{{load_starter_plan_button_visible}}", "operator": "equals", "transforms": []}, {"description": "The home screen shows the notice \"Guest mode: your data lives only in this browser.\"", "store_key": "guest_mode_notice_visible", "expected_value": "true", "extracted_value": "{{guest_mode_notice_visible}}", "operator": "equals", "transforms": []}], "composite_operator": "and", "claim": "the home screen shows a \"Load starter plan\" button and the notice \"Guest mode: your data lives only in this browser.\""});
  });
  
  await testmu.step("Clicking Load starter plan button", { instructionId: "7652d7b3-f0be-4938-9eba-36773055091b" }, async () => {
    element_1 = page.locator("internal:role=button[name=\"Load starter plan\"i]");
    await element_1.click();
  });
  
  await testmu.step("Clicking the Full Body starter-plan button", { instructionId: "e70dca23-5b87-4335-87b9-3905f3eb6014" }, async () => {
    element_2 = page.locator("internal:role=button[name=\"Full Body 3 days per week \u00b7\"i]");
    await element_2.click();
  });
  
  await testmu.step("whether the Load starter plan button is present on the home screen", { instructionId: "508788da-f2a2-4a90-8f6c-910d1a3a833f" }, async () => {
    setVar("load_starter_plan_button_absent", await testmu.visionQuery(page, "whether the Load starter plan button is present on the home screen", ""));
  });
  
  await testmu.step("Assertion check", { instructionId: "9704a3a8-7677-476b-ba95-6e17e1265f7f" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {"operator": ["equals"], "assertion_operands": [], "left_operand": null, "right_operand": null, "operands": [], "sub_results": [{"description": "The \"Load starter plan\" button is no longer shown on the home screen.", "passed": true, "operator": "equals", "transforms": [], "json_path": null, "expected": "false", "extracted_value": "{{load_starter_plan_button_absent}}", "store_key": "load_starter_plan_button_absent", "variable_refs": {"{{load_starter_plan_button_absent}}": "false"}}], "sub_checks": [{"description": "The \"Load starter plan\" button is no longer shown on the home screen.", "store_key": "load_starter_plan_button_absent", "expected_value": "false", "extracted_value": "{{load_starter_plan_button_absent}}", "operator": "equals", "transforms": []}], "composite_operator": "and", "claim": "the \"Load starter plan\" button is no longer shown on the home screen"});
  });
  
  await testmu.step("Clicking the Plan navigation button", { instructionId: "da3e14eb-bf2b-4ba8-b30e-56e140ca038d" }, async () => {
    element_3 = page.locator("internal:role=button[name=\"Plan\"i]");
    await element_3.click();
  });
  
  await testmu.step("Checking the Full Body A exercise count in the weekly schedule", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("full_body_a_exercises_check", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {14: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (/Full Body A\\s*6 exercises/.test(el(14).innerText));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:role=button[name=\"Monday\"i]"], query: "whether the Monday weekly schedule entry lists Full Body A with 6 exercises", expectedValue: "true", needsUnitConversion: false, operator: "equals", transforms: [], condition: "The weekly schedule lists \"Full Body A\" with \"6 exercises\"." }));
  });
  
  await testmu.step("Checking the Full Body B exercise count in the weekly schedule", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("full_body_b_exercises_check", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {16: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (/Full Body B\\s*6 exercises/.test(el(16).innerText));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:role=button[name=\"Wednesday\"i]"], query: "whether the Wednesday weekly schedule entry lists Full Body B with 6 exercises", expectedValue: "true", needsUnitConversion: false, operator: "equals", transforms: [], condition: "The weekly schedule lists \"Full Body B\" with \"6 exercises\"." }));
  });
  
  await testmu.step("Checking the Full Body C exercise count in the weekly schedule", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("full_body_c_exercises_check", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {18: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (/Full Body C\\s*6 exercises/.test(el(18).innerText));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:role=button[name=\"Friday\"i]"], query: "whether the Friday weekly schedule entry lists Full Body C with 6 exercises", expectedValue: "true", needsUnitConversion: false, operator: "equals", transforms: [], condition: "The weekly schedule lists \"Full Body C\" with \"6 exercises\"." }));
  });
  
  await testmu.step("Assertion check", { instructionId: "696c7b15-ad04-4c31-9169-9622c661280f" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {"operator": ["equals"], "assertion_operands": [], "left_operand": null, "right_operand": null, "operands": [], "sub_results": [{"description": "The weekly schedule lists \"Full Body A\" with \"6 exercises\".", "passed": true, "operator": "equals", "transforms": [], "json_path": null, "expected": "true", "extracted_value": "{{full_body_a_exercises_check}}", "store_key": "full_body_a_exercises_check", "variable_refs": {"{{full_body_a_exercises_check}}": "true"}}], "sub_checks": [{"description": "The weekly schedule lists \"Full Body A\" with \"6 exercises\".", "store_key": "full_body_a_exercises_check", "expected_value": "true", "extracted_value": "{{full_body_a_exercises_check}}", "operator": "equals", "transforms": []}], "composite_operator": "and", "claim": "the weekly schedule lists \"Full Body A\" with \"6 exercises\""});
  });
  
  await testmu.step("Assertion check", { instructionId: "4cb9db02-a50b-4cf3-8e43-a270d7ebacf6" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {"operator": ["equals"], "assertion_operands": [], "left_operand": null, "right_operand": null, "operands": [], "sub_results": [{"description": "The weekly schedule lists \"Full Body B\" with \"6 exercises\".", "passed": true, "operator": "equals", "transforms": [], "json_path": null, "expected": "true", "extracted_value": "{{full_body_b_exercises_check}}", "store_key": "full_body_b_exercises_check", "variable_refs": {"{{full_body_b_exercises_check}}": "true"}}], "sub_checks": [{"description": "The weekly schedule lists \"Full Body B\" with \"6 exercises\".", "store_key": "full_body_b_exercises_check", "expected_value": "true", "extracted_value": "{{full_body_b_exercises_check}}", "operator": "equals", "transforms": []}], "composite_operator": "and", "claim": "the weekly schedule lists \"Full Body B\" with \"6 exercises\""});
  });
  
  await testmu.step("Assertion check", { instructionId: "873e52c7-7540-44b1-982a-db6a51b1dc85" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {"operator": ["equals"], "assertion_operands": [], "left_operand": null, "right_operand": null, "operands": [], "sub_results": [{"description": "The weekly schedule lists \"Full Body C\" with \"6 exercises\".", "passed": true, "operator": "equals", "transforms": [], "json_path": null, "expected": "true", "extracted_value": "{{full_body_c_exercises_check}}", "store_key": "full_body_c_exercises_check", "variable_refs": {"{{full_body_c_exercises_check}}": "true"}}], "sub_checks": [{"description": "The weekly schedule lists \"Full Body C\" with \"6 exercises\".", "store_key": "full_body_c_exercises_check", "expected_value": "true", "extracted_value": "{{full_body_c_exercises_check}}", "operator": "equals", "transforms": []}], "composite_operator": "and", "claim": "the weekly schedule lists \"Full Body C\" with \"6 exercises\""});
  });
});

testmu.run();