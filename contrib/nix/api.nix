{
  lib,
  buildNpmPackage,
  nodejs_26,
  makeWrapper,
  importNpmLock,
  version,
}:

buildNpmPackage rec {
  pname = "opengym-api";
  inherit version;

  src = ./../../api;

  nodejs = nodejs_26;

  npmDeps = importNpmLock { npmRoot = src; };
  npmConfigHook = importNpmLock.npmConfigHook;

  dontNpmBuild = true;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/opengym-api

    # Dependencies first
    cp -r node_modules $out/lib/opengym-api/

    # Root-level sources
    cp ./*.js $out/lib/opengym-api/

    # Every source directory, minus node_modules (already copied) and the ones that are
    # not runtime code (test/, scripts/) — the same two the Dockerfile's COPY line names.
    for dir in ./*/; do
      case $dir in
        ./node_modules/|./test/|./scripts/) ;;
        *) cp -r "$dir" $out/lib/opengym-api/ ;;
      esac
    done

    mkdir -p $out/bin
    makeWrapper ${nodejs_26}/bin/node $out/bin/opengym-api \
      --add-flags "$out/lib/opengym-api/server.js" \
      --set NODE_ENV production
    runHook postInstall
  '';

  meta = with lib; {
    description = "openGym API — passkey auth + per-user workout data (Node.js)";
    homepage = "https://gitlab.com/DuarteSantos8/opengym";
    license = licenses.agpl3Plus;
    platforms = nodejs.meta.platforms;
  };
}
