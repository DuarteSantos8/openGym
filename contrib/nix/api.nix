{
  lib,
  buildNpmPackage,
  nodejs_22,
  makeWrapper,
  importNpmLock,
  version,
}:

buildNpmPackage rec {
  pname = "opengym-api";
  inherit version;

  src = ./../../api;

  nodejs = nodejs_22;

  npmDeps = importNpmLock { npmRoot = src; };
  npmConfigHook = importNpmLock.npmConfigHook;

  dontNpmBuild = true;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/opengym-api
    cp -r node_modules $out/lib/opengym-api/
    cp ./*.js $out/lib/opengym-api/

    # …and every package directory under the api root (coach/, integrations/, …). server.js
    # imports ./integrations/index.js and ./coach/config.js, and "a whole directory" is
    # exactly what a list of module names cannot say: 1.4.4 added integrations/ and this
    # package kept shipping without it, so the unit died at boot with ERR_MODULE_NOT_FOUND —
    # on a machine far from this one, thousands of restarts deep. api/Dockerfile's COPY line
    # needed the same fix; api/test/dockerfile-copy.test.js guards it there.
    # test/ and scripts/ are deliberately left behind: neither is runtime code.
    for dir in ./*/; do
      case $dir in
        ./node_modules/|./test/|./scripts/) ;;
        *) cp -r "$dir" $out/lib/opengym-api/ ;;
      esac
    done

    # Now prove the staged tree resolves every relative import in it — the check a copy
    # list can never make for itself. Without this the next subdirectory that appears ships
    # incomplete and only fails at boot; with it the build fails here, where it is cheap.
    unresolved=0
    while IFS= read -r file; do
      dir=$(dirname "$file")
      while IFS= read -r spec; do
        resolved=no
        for cand in "$dir/$spec" "$dir/$spec.js" "$dir/$spec.mjs" "$dir/$spec/index.js" "$dir/$spec/index.mjs"; do
          if [ -f "$cand" ]; then resolved=yes; break; fi
        done
        if [ "$resolved" = no ]; then
          echo "opengym-api: '$spec' imported by ''${file#$out/lib/opengym-api/} is not in the package" >&2
          unresolved=1
        fi
      done < <(grep -ohE "(from[[:space:]]+|import[[:space:]]*\([[:space:]]*)['\"]\.[^'\"]+['\"]" "$file" | sed -E "s/.*['\"](\.[^'\"]+)['\"].*/\1/" | sort -u)
    done < <(find "$out/lib/opengym-api" -path '*/node_modules' -prune -o \( -name '*.js' -o -name '*.mjs' \) -print)
    if [ "$unresolved" != 0 ]; then
      echo "opengym-api: a module the server imports is missing from the package — the unit would boot as ERR_MODULE_NOT_FOUND" >&2
      exit 1
    fi

    mkdir -p $out/bin
    makeWrapper ${nodejs_22}/bin/node $out/bin/opengym-api \
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
