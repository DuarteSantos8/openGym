{
  lib,
  buildNpmPackage,
  nodejs_26,
  makeWrapper,
  importNpmLock,
  version,
}:

buildNpmPackage rec {
  pname = "opengym-mcp";
  inherit version;

  src = ./../../mcp;

  # The MCP server reads shared domain helpers from the sibling frontend/src/lib; include them.
  frontendSrc = lib.cleanSource ./../../frontend;

  # frontend/src/lib imports from ../../../api/ (coach/core/*, sync-stamps.js, consent.js, …),
  # so the api tree must be staged at $out/lib/api as well — the working directory at install
  # time is the mcp source only, so it cannot reach ../.. on its own.
  apiSrc = lib.cleanSource ./../../api;

  nodejs = nodejs_26;

  npmDeps = importNpmLock { npmRoot = src; };
  npmConfigHook = importNpmLock.npmConfigHook;

  dontNpmBuild = true;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/opengym-mcp
    cp -r node_modules $out/lib/opengym-mcp/
    cp -r src $out/lib/opengym-mcp/

    # The MCP server imports shared training/domain helpers from ../../frontend/src/lib
    # (history, exercises, muscles, onerm, progression, workout-model, format, …). They are
    # resolved relative to $out/lib/opengym-mcp/src, so they must sit at $out/lib/frontend/src/lib.
    mkdir -p $out/lib/frontend/src
    cp -r $frontendSrc/src/lib $out/lib/frontend/src/lib

    # frontend/src/lib imports from ../../../api/ (coach/core/*, sync-stamps.js, consent.js, …).
    # Only the runtime tree ships: coach/ plus the top-level modules the frontend reaches.
    # test/ and scripts/ are not runtime code, and node_modules belongs to the api's own
    # package (the MCP server has its own copy).
    mkdir -p $out/lib/api
    cp -r $apiSrc/coach $out/lib/api/
    cp -r $apiSrc/integrations $out/lib/api/
    for f in $apiSrc/*.js; do
      if [ -e "$f" ]; then cp "$f" $out/lib/api/; fi
    done

    mkdir -p $out/bin
    makeWrapper ${nodejs_26}/bin/node $out/bin/opengym-mcp \
      --add-flags "$out/lib/opengym-mcp/src/index.js" \
      --set NODE_ENV production
    runHook postInstall
  '';

  meta = with lib; {
    description = "openGym MCP server — read-only stdio bridge for LLM clients";
    homepage = "https://gitlab.com/DuarteSantos8/opengym";
    license = licenses.agpl3Plus;
    platforms = nodejs.meta.platforms;
  };
}
