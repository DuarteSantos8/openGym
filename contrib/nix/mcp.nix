{
  lib,
  buildNpmPackage,
  nodejs_26,
  makeWrapper,
  importNpmLock,
  rsync,
  version,
}:

(import ./node-package.nix {
  inherit
    lib
    buildNpmPackage
    makeWrapper
    importNpmLock
    rsync
    ;
  nodejs = nodejs_26;
  pname = "opengym-mcp";
  description = "openGym MCP server — read-only stdio bridge for LLM clients";
  inherit version;
  src = ./../../mcp;
  entry = "src/index.js";
  extraTrees = [
    {
      from = lib.cleanSource ./../../frontend;
      at = "../../frontend/src/lib";
    }
    {
      from = lib.cleanSource ./../../api;
      at = "../../../api";
    }
  ];
})
