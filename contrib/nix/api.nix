# The API package: its layout is one declaration over the shared packaging module —
# staging, the import-resolution proof and the wrapper live there, beside the MCP
# server's, so the next package cannot forget them. The whole api/ tree is runtime
# code except test/ and scripts/ (node-package.nix's default), the same two names the
# Dockerfile's COPY line leaves behind.
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
  pname = "opengym-api";
  description = "openGym API — passkey auth + per-user workout data (Node.js)";
  src = ./../../api;
  entry = "server.js";
}
