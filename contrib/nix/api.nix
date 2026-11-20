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
  pname = "opengym-api";
  description = "openGym API — passkey auth + per-user workout data (Node.js)";
  inherit version;
  src = ./../../api;
  entry = "server.js";
})
