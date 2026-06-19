/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function loadMergeFieldsModule() {
  const filename = path.join(__dirname, "..", "src", "lib", "communication-merge-fields.ts");
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;

  const moduleWrapper = { exports: {} };
  const context = vm.createContext({
    exports: moduleWrapper.exports,
    module: moduleWrapper,
    require,
  });
  const script = new vm.Script(output, { filename });
  script.runInContext(context);
  return moduleWrapper.exports;
}

const { firstNameForMerge, formatNameForMerge } = loadMergeFieldsModule();

assert.equal(formatNameForMerge("JOHN SMITH"), "John Smith");
assert.equal(formatNameForMerge("  JANE   MARY-SMITH  "), "Jane Mary-Smith");
assert.equal(formatNameForMerge("Reddyn Wallace"), "Reddyn Wallace");
assert.equal(formatNameForMerge("ACME LTD"), "Acme Ltd");
assert.equal(firstNameForMerge("JANE SMITH"), "Jane");
assert.equal(firstNameForMerge("Reddyn Wallace"), "Reddyn");

console.log("communication merge field tests passed");
