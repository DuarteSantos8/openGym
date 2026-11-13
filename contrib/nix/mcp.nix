# The MCP package: its layout is one declaration over the shared packaging module.
# The server reads shared training/domain helpers from ../../frontend/src/lib, so that
# tree is staged by the `at` path — spelled exactly like the import that needs it,
# relative to the entry, which keeps the depth invariant checkable by the module.
#
# (The unified staging copies a root-level vitest.config.js the old file left behind;
# it only loads under the vitest CLI, so the package gains a file and no behaviour.)
{
  lib,
  buildNpmPackage,
  nodejs_22,
  makeWrapper,
  importNpmLock,
  version,
}:

import ./node-package.nix {
  inherit
    lib
    buildNpmPackage
    nodejs_22
    makeWrapper
    importNpmLock
    version
    ;
  pname = "opengym-mcp";
  description = "openGym MCP server — read-only stdio bridge for LLM clients";
  src = ./../../mcp;
  entry = "src/index.js";
  extraTrees = [
    {
      from = ./../../frontend/src/lib;
      at = "../../frontend/src/lib";
    }
  ];
}
