import testmu, { resolveVar, setVar } from '@testmuai/playwright-bindings';
import { expect } from '@playwright/test';

testmu.configure({
  "build": "25895c07-63b4-4870-ba33-06883f9d21b8",
  "name": "Complete and Save a Full Body Workout",
  "tcId": "TC-184",
  "network": (process.env.NETWORK ?? "false").toLowerCase() === "true",
  "autoHealVersion": "AH2",
  "defaultActionTimeoutMs": 10000,
  "defaultNavigationTimeoutMs": 60000,
  "kaneRunV4": true
});

testmu.test("Complete and Save a Full Body Workout", async (page) => {
  let element_1, element_2, element_3, element_4, element_0, element_6, element_7, element_8, element_9, element_10;
  await testmu.step("Navigate to http://localhost:8080/", { instructionId: "7bd7eeef-b908-4edc-87ef-bba61d80474e" }, async () => {
    await page.goto("http://localhost:8080/");
  });
  
  await testmu.step("Clicking Continue without account button", { instructionId: "6e2512db-39f5-4e08-bd4c-59fc24aadb75" }, async () => {
    element_1 = page.locator("internal:role=button[name=\"Continue without account\"i]");
    await element_1.click();
  });
  
  await testmu.step("Clicking Load starter plan button on the home welcome card", { instructionId: "481f0dc6-0bd7-4fb3-b7f0-e86e0ce36375" }, async () => {
    element_2 = page.locator("internal:role=button[name=\"Load starter plan\"i]");
    await element_2.click();
  });
  
  await testmu.step("Clicking Full Body 3 days per week starter plan option", { instructionId: "b5c1f178-4f6e-46ed-8386-62062fbb12ce" }, async () => {
    element_3 = page.locator("internal:role=button[name=\"Full Body 3 days per week \u00b7\"i]");
    await element_3.click();
  });
  
  await testmu.step("Reading the workouts total from the home screen summary", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("home_screen_workouts_total", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {19: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(19).innerText);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:role=button[name=\"0 week streak 0 / 3 this week\"i]"], query: "the workouts total shown in the home screen activity summary", expectedValue: "0 workouts total", needsUnitConversion: false, operator: "contains", transforms: ["strip"], condition: "The home screen shows \"0 workouts total\"." }));
  });
  
  await testmu.step("Assertion check", { instructionId: "24b9db99-ed30-4f54-a3ae-1308710d4ab6" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {"operator": ["equals"], "assertion_operands": [], "left_operand": null, "right_operand": null, "operands": [], "sub_results": [{"description": "The home screen shows \"0 workouts total\".", "passed": true, "operator": "contains", "transforms": ["strip"], "json_path": null, "expected": "0 workouts total", "extracted_value": "{{home_screen_workouts_total}}", "store_key": "home_screen_workouts_total", "variable_refs": {"{{home_screen_workouts_total}}": "0 week streak\n0 / 3 this week \u00b7 0 workouts total"}}], "sub_checks": [{"description": "The home screen shows \"0 workouts total\".", "store_key": "home_screen_workouts_total", "expected_value": "0 workouts total", "extracted_value": "{{home_screen_workouts_total}}", "operator": "contains", "transforms": ["strip"]}], "composite_operator": "and", "claim": "the home screen shows \"0 workouts total\""});
  });
  
  await testmu.step("Clicking Start button in the bottom navigation bar", { instructionId: "33193dd0-6615-4095-929c-6a939ad49ef4" }, async () => {
    element_4 = page.locator("internal:role=button[name=\"Start\"s]");
    await element_4.click();
  });
  
  await testmu.step("whether the page presents a prompt to choose a workout", { instructionId: "f34581d1-904b-4f30-b632-aa707111c905" }, async () => {
    setVar("cp_1", await testmu.visionQuery(page, "whether the page presents a prompt to choose a workout", ""));
  });
  
  if (await testmu.evaluateBranch([{"description": "The page asks to choose a workout.", "store_key": "cp_1", "expected_value": "true", "operator": "equals", "transforms": []}], "and")) {
    page = await testmu.executeKaneCli("choose \"Full Body A", page);
  }
  
  await testmu.step("Checking whether the Finish button is present", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("finish_button_visible", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {5: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(5) !== null && el(5).textContent.trim() === 'Finish');\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:role=button[name=\"Finish\"s]"], query: "whether the Finish button is present on the workout screen", expectedValue: "true", needsUnitConversion: false, operator: "equals", transforms: [], condition: "The workout screen shows a \"Finish\" button." }));
  });
  
  await testmu.step("Checking whether the set counter starts with 0/", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("set_counter_starts_0", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {3: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (/(?:^|\\s)0\\/\\d+\\s+sets(?:\\s|$)/.test(el(3).innerText));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:text=\":33 \u00b7 0/16 sets\"i"], query: "whether the workout set counter starts with 0/", expectedValue: "true", needsUnitConversion: false, operator: "equals", transforms: [], condition: "The set counter starts at \"0/\"." }));
  });
  
  await testmu.step("Assertion check", { instructionId: "a7119146-c5ff-4704-b17c-8a435aaf9d74" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {"operator": ["equals"], "assertion_operands": [], "left_operand": null, "right_operand": null, "operands": [], "sub_results": [{"description": "The workout screen shows a \"Finish\" button.", "passed": true, "operator": "equals", "transforms": [], "json_path": null, "expected": "true", "extracted_value": "{{finish_button_visible}}", "store_key": "finish_button_visible", "variable_refs": {"{{finish_button_visible}}": "true"}}, {"description": "The set counter starts at \"0/\".", "passed": true, "operator": "equals", "transforms": [], "json_path": null, "expected": "true", "extracted_value": "{{set_counter_starts_0}}", "store_key": "set_counter_starts_0", "variable_refs": {"{{set_counter_starts_0}}": "true"}}], "sub_checks": [{"description": "The workout screen shows a \"Finish\" button.", "store_key": "finish_button_visible", "expected_value": "true", "extracted_value": "{{finish_button_visible}}", "operator": "equals", "transforms": []}, {"description": "The set counter starts at \"0/\".", "store_key": "set_counter_starts_0", "expected_value": "true", "extracted_value": "{{set_counter_starts_0}}", "operator": "equals", "transforms": []}], "composite_operator": "and", "claim": "the workout screen shows a \"Finish\" button and the set counter starts at \"0/\""});
  });
  
  await testmu.step("Typing 40 into the weight input", { instructionId: "885693a3-f71e-486b-9482-dce036718540" }, async () => {
    element_0 = page.locator("internal:role=textbox >> nth=0");
    await element_0.click();
    await element_0.fill("40");
  });
  
  await testmu.step("Clicking Set 1 done checkbox", { instructionId: "101e0945-4c01-4278-82c1-fa0ec9a468a4" }, async () => {
    element_6 = page.locator("internal:role=checkbox[name=\"Set 1 done\"i]");
    await element_6.click();
  });
  
  await testmu.step("Reading the set counter at the top of the workout", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("set_counter_check", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {3: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(3).innerText);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:text=\":08 \u00b7 1/16 sets\"i"], query: "the set counter displayed at the top of the workout", expectedValue: "1/", needsUnitConversion: false, operator: "contains", transforms: [], condition: "The set counter at the top shows \"1/\"." }));
  });
  
  await testmu.step("Assertion check", { instructionId: "1812daf3-26ac-4b9d-9c37-429764250925" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {"operator": ["equals"], "assertion_operands": [], "left_operand": null, "right_operand": null, "operands": [], "sub_results": [{"description": "The set counter at the top shows \"1/\".", "passed": true, "operator": "contains", "transforms": [], "json_path": null, "expected": "1/", "extracted_value": "{{set_counter_check}}", "store_key": "set_counter_check", "variable_refs": {"{{set_counter_check}}": "1:08 \u00b7 1/16 sets"}}], "sub_checks": [{"description": "The set counter at the top shows \"1/\".", "store_key": "set_counter_check", "expected_value": "1/", "extracted_value": "{{set_counter_check}}", "operator": "contains", "transforms": []}], "composite_operator": "and", "claim": "the set counter at the top shows \"1/\""});
  });
  
  await testmu.step("Clicking Finish workout button", { instructionId: "7c93d84f-008e-492c-bee6-e0f80473b65f" }, async () => {
    element_7 = page.locator("internal:role=button[name=\"Finish\"s]");
    await element_7.click();
  });
  
  await testmu.step("Clicking Finish and save in the confirmation dialog", { instructionId: "ffa12929-da2f-4df6-92d5-fb2ef27abd07" }, async () => {
    element_8 = page.locator("internal:role=button[name=\"Finish and save\"i]");
    await element_8.click();
  });
  
  await testmu.step("Checking whether a workout summary is shown", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("cp_1", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {20: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(20) !== null && /workout complete/i.test(el(20).textContent));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:role=heading[name=\"Workout complete!\"i]"], query: "whether a workout summary is shown", expectedValue: "true", needsUnitConversion: false, operator: "equals", transforms: [], condition: "A workout summary is shown." }));
  });
  
  if (await testmu.evaluateBranch([{"description": "A workout summary is shown.", "store_key": "cp_1", "expected_value": "true", "stored_value": "{{cp_1}}", "operator": "equals", "transforms": []}], "and")) {
    await testmu.step("Clicking dismissing workout completion summary modal button", { instructionId: "75e3cbb5-6d48-43fc-9880-f81133c19a17" }, async () => {
      element_9 = page.locator("internal:role=button[name=\"Nice!\"i]");
      await element_9.click();
    });
  }
  
  await testmu.step("Clicking Home navigation button", { instructionId: "f841c17d-81f8-4b7e-a548-6d844b0b7b27" }, async () => {
    element_10 = page.locator("internal:role=button[name=\"Home\"i]");
    await element_10.click();
  });
  
  await testmu.step("Reading the workout total from the home screen summary", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("one_workout_total_check", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {19: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(19).innerText);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:role=button[name=\"1 week streak 1 / 3 this week\"i]"], query: "the workout total text shown in the home screen weekly summary", expectedValue: "1 workout total", needsUnitConversion: false, operator: "contains", transforms: ["strip"], condition: "The home screen shows \"1 workout total\"." }));
  });
  
  await testmu.step("Reading the workout total from the home screen summary", async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    setVar("one_workouts_total_check", await testmu.textualAnalyzer(page, { wrappedJs: "(els) => {\n  const __m = {19: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(19).innerText);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators: ["internal:role=button[name=\"1 week streak 1 / 3 this week\"i]"], query: "the workout total text shown in the home screen weekly summary", expectedValue: "1 workouts total", needsUnitConversion: false, operator: "contains", transforms: ["strip"], condition: "The home screen shows \"1 workouts total\"." }));
  });
  
  await testmu.step("Assertion check", { instructionId: "761b0d7d-25a8-4879-86de-cdd48e1fbb30" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {"operator": ["equals"], "assertion_operands": [], "left_operand": null, "right_operand": null, "operands": [], "sub_results": [{"description": "The home screen shows \"1 workout total\".", "passed": true, "operator": "contains", "transforms": ["strip"], "json_path": null, "expected": "1 workout total", "extracted_value": "{{one_workout_total_check}}", "store_key": "one_workout_total_check", "variable_refs": {"{{one_workout_total_check}}": "1 week streak\n1 / 3 this week \u00b7 1 workout total"}}, {"description": "The home screen shows \"1 workouts total\".", "passed": false, "operator": "contains", "transforms": ["strip"], "json_path": null, "expected": "1 workouts total", "extracted_value": "{{one_workouts_total_check}}", "store_key": "one_workouts_total_check", "variable_refs": {"{{one_workouts_total_check}}": "1 week streak\n1 / 3 this week \u00b7 1 workout total"}}], "sub_checks": [{"description": "The home screen shows \"1 workout total\".", "store_key": "one_workout_total_check", "expected_value": "1 workout total", "extracted_value": "{{one_workout_total_check}}", "operator": "contains", "transforms": ["strip"]}, {"description": "The home screen shows \"1 workouts total\".", "store_key": "one_workouts_total_check", "expected_value": "1 workouts total", "extracted_value": "{{one_workouts_total_check}}", "operator": "contains", "transforms": ["strip"]}], "composite_operator": "or", "claim": "the home screen shows \"1 workout total\" or \"1 workouts total\""});
  });
});

testmu.run();