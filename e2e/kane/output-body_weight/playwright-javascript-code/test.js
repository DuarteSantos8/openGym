import testmu, { resolveVar, setVar } from '@testmuai/playwright-bindings';
import { expect } from '@playwright/test';

testmu.configure({
  "build": "0391aa2a-0f2c-4ef2-9860-eb52c29b93e2",
  "name": "Log Body Weight Entry",
  "tcId": "TC-183",
  "network": (process.env.NETWORK ?? "false").toLowerCase() === "true",
  "autoHealVersion": "AH2",
  "defaultActionTimeoutMs": 10000,
  "defaultNavigationTimeoutMs": 60000,
  "kaneRunV4": true
});

testmu.test("Log Body Weight Entry", async (page) => {
  let element_1, element_2, element_0, element_4;
  await testmu.step("Navigate to http://localhost:8080/", { instructionId: "f2a8498a-05ee-4a35-9202-b91ed8ca27f4" }, async () => {
    await page.goto("http://localhost:8080/");
  });
  
  await testmu.step("Clicking Continue without account", { instructionId: "f2c83bea-d228-449b-a825-96d8e1e91c95" }, async () => {
    element_1 = page.locator("internal:role=button[name=\"Continue without account\"i]");
    await element_1.click();
  });
  
  await testmu.step("The \"Body weight\" card displays the text \"No weigh-ins yet.\"", { instructionId: "1962b55e-88d4-4c63-bcb6-8ffa561ebbda" }, async () => {
    setVar("body_weight_no_weigh_ins_check", await testmu.visionQuery(page, "The \"Body weight\" card displays the text \"No weigh-ins yet.\"", ""));
  });
  
  await testmu.step("Assertion check", { instructionId: "f2a20777-cee0-466b-8619-a2d3460c6fbd" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {"operator": ["equals"], "assertion_operands": [], "left_operand": null, "right_operand": null, "operands": [], "sub_results": [{"description": "The \"Body weight\" card displays the text \"No weigh-ins yet.\"", "passed": true, "operator": "contains", "transforms": [], "json_path": null, "expected": "No weigh-ins yet.", "extracted_value": "{{body_weight_no_weigh_ins_check}}", "store_key": "body_weight_no_weigh_ins_check", "variable_refs": {"{{body_weight_no_weigh_ins_check}}": "No weigh-ins yet. Log your weight to start the curve."}}], "sub_checks": [{"description": "The \"Body weight\" card displays the text \"No weigh-ins yet.\"", "store_key": "body_weight_no_weigh_ins_check", "expected_value": "No weigh-ins yet.", "extracted_value": "{{body_weight_no_weigh_ins_check}}", "operator": "contains", "transforms": []}], "composite_operator": "and", "claim": "the \"Body weight\" card shows \"No weigh-ins yet.\""});
  });
  
  await testmu.step("Clicking Log button in Body weight card", { instructionId: "3cfdfc3d-f1c8-4dab-9cb8-789839685d0c" }, async () => {
    element_2 = page.locator("internal:role=button[name=\"Log\"i]");
    await element_2.click();
  });
  
  await testmu.step("Waiting for weight input field and save button", { instructionId: "188e7c27-8d17-48f3-a578-0b580d711ba9" }, async () => {
    await page.waitForTimeout(1000);
  });
  
  await testmu.step("Type \"80\" into \"Weight (kg)\"", { instructionId: "de005e25-6922-47d5-afaa-f750cfd00440" }, async () => {
    element_0 = page.locator("internal:role=textbox[name=\"Weight (kg)\"i]");
    await element_0.click();
    await element_0.fill("80");
  });
  
  await testmu.step("Click \"Save\"", { instructionId: "27f7f273-351d-4af2-b663-30256ba03f86" }, async () => {
    element_4 = page.locator("internal:role=button[name=\"Save\"i]");
    await element_4.click();
  });
  
  await testmu.step("whether the text \"No weigh-ins yet.\" is present in the Body weight card", { instructionId: "2a8ef277-3ba9-477e-bf43-f5c73d6d0c57" }, async () => {
    setVar("body_weight_no_weigh_ins_absent", await testmu.visionQuery(page, "whether the text \"No weigh-ins yet.\" is present in the Body weight card", ""));
  });
  
  await testmu.step("The \"Body weight\" card shows a weight of 80 kg.", { instructionId: "3a77d955-08f8-4c05-9079-400d6a7c9fc0" }, async () => {
    setVar("body_weight_80_kg", await testmu.visionQuery(page, "The \"Body weight\" card shows a weight of 80 kg.", ""));
  });
  
  await testmu.step("Assertion check", { instructionId: "f019b76a-5efa-4e6a-bf9c-aef2f6f03be0" }, async () => {
    await testmu.verifyAssertion(page, "Assertion check", {"operator": ["equals"], "assertion_operands": [], "left_operand": null, "right_operand": null, "operands": [], "sub_results": [{"description": "The \"Body weight\" card no longer shows \"No weigh-ins yet.\"", "passed": true, "operator": "equals", "transforms": [], "json_path": null, "expected": "false", "extracted_value": "{{body_weight_no_weigh_ins_absent}}", "store_key": "body_weight_no_weigh_ins_absent", "variable_refs": {"{{body_weight_no_weigh_ins_absent}}": "false"}}, {"description": "The \"Body weight\" card shows a weight of 80 kg.", "passed": true, "operator": "equals", "transforms": ["strip"], "json_path": null, "expected": "80 kg", "extracted_value": "{{body_weight_80_kg}}", "store_key": "body_weight_80_kg", "variable_refs": {"{{body_weight_80_kg}}": "80 kg"}}], "sub_checks": [{"description": "The \"Body weight\" card no longer shows \"No weigh-ins yet.\"", "store_key": "body_weight_no_weigh_ins_absent", "expected_value": "false", "extracted_value": "{{body_weight_no_weigh_ins_absent}}", "operator": "equals", "transforms": []}, {"description": "The \"Body weight\" card shows a weight of 80 kg.", "store_key": "body_weight_80_kg", "expected_value": "80 kg", "extracted_value": "{{body_weight_80_kg}}", "operator": "equals", "transforms": ["strip"]}], "composite_operator": "and", "claim": "Verify the \"Body weight\" card no longer shows \"No weigh-ins yet.\" and shows a weight of 80 kg."});
  });
});

testmu.run();