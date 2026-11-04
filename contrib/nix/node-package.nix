# The packaging module shared by openGym's Node applications (the API and the MCP
# server — the frontend compiles a bundle instead, see frontend.nix).
#
# It stages a package and then proves it: dependencies, the runtime sources, any tree
# the entry's imports reach, and a bin wrapper — then it walks the entry's whole
# import graph and fails the build if anything reachable is missing. That proof is the
# point: a copy list can never check itself, and 1.4.4 shipped an api/ that died at
# boot as ERR_MODULE_NOT_FOUND (integrations/ was not in the copy list), thousands of
# restarts deep. Here the build fails, where it is cheap. For the MCP server the same
# walk keeps the borrowed frontend/src/lib helpers at the path its imports expect — an
# invariant that used to be a comment someone had to keep true by hand.
#
# The interface is the package's layout:
#
#   pname        package name — also the bin/ name and the $out/lib/<pname> directory
#   description  one-line summary (meta)
#   version      release version (default.nix derives it from the manifests)
#   src          source tree — package.json and package-lock.json live here
#   entry        the module the wrapper boots, relative to src ("server.js",
#                "src/index.js") — the first root of the import walk
#   excludeDirs  source directories that are not runtime code; defaults to test/ and
#                scripts/, the two the Dockerfile's COPY line also leaves behind
#   extraTrees   trees from a sibling project the entry's relative imports reach:
#                [{ from = …; at = "../../frontend/src/lib"; }] — `at` is relative to
#                the entry's own directory, so it reads like the import it satisfies
{
  lib,
  buildNpmPackage,
  nodejs_22,
  makeWrapper,
  importNpmLock,
  pname,
  description,
  version,
  src,
  entry,
  excludeDirs ? [
    "test"
    "scripts"
  ],
  extraTrees ? [ ],
}:

let
  libDir = "$out/lib/${pname}";
  entryDir = "${libDir}/${dirOf entry}";

  # Resolve an `at` against the entry's directory in Nix rather than in shell, so no
  # mkdir has to interpret a ".." (portable to BSD mkdir): "../../frontend/src/lib"
  # from "$out/lib/opengym-mcp/src" is "$out/lib/frontend/src/lib".
  resolveAt =
    base: rel:
    let
      baseParts = lib.filter (p: p != "." && p != "") (lib.splitString "/" base);
      relParts = lib.filter (p: p != "." && p != "") (lib.splitString "/" rel);
    in
    builtins.concatStringsSep "/" (
      lib.foldl' (acc: part: if part == ".." then lib.init acc else acc ++ [ part ]) baseParts relParts
    );

  # node_modules is never staged by the directory loop (it is copied on its own
  # first); excludeDirs are the caller's "not runtime code" directories.
  notStaged = map (d: "./${d}/") ([ "node_modules" ] ++ excludeDirs);
in
buildNpmPackage {
  inherit
    pname
    version
    src
    description
    ;

  nodejs = nodejs_22;

  npmDeps = importNpmLock { npmRoot = src; };
  npmConfigHook = importNpmLock.npmConfigHook;

  dontNpmBuild = true;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p ${libDir}

    # Dependencies first: every bare specifier resolves against this copy (a package
    # with no dependencies has no node_modules to copy).
    if [ -e node_modules ]; then cp -r node_modules ${libDir}/; fi

    # Root-level sources (server.js and friends for the API; vitest.config.js for the
    # MCP server — a file no argument of the wrapper ever loads).
    for f in ./*.js; do
      if [ -e "$f" ]; then cp "$f" ${libDir}/; fi
    done

    # Every source directory, minus the ones that are not runtime code — the same
    # names the Dockerfile's COPY line names (guarded there, on the Docker path, by
    # api/test/dockerfile-copy.test.js).
    for dir in ./*/; do
      case $dir in
        ${lib.concatStringsSep "|" notStaged}) ;;
        *) cp -r "$dir" ${libDir}/ ;;
      esac
    done
  ''
  + lib.concatStringsSep "\n" (
    map (tree: ''
      # A tree the entry's imports reach, staged exactly where the import says. Only
      # the parent is made: cp -r into an existing directory would nest the tree one
      # level deeper than the import that needs it.
      mkdir -p $(dirname ${resolveAt entryDir tree.at})
      cp -r ${tree.from} ${resolveAt entryDir tree.at}
    '') extraTrees
  )
  + ''

    # Proof the staged package boots: every relative import of every module it
    # ships, transitively, must resolve inside the package. The roots are the entry
    # and every staged source file under the package's own tree — a standalone
    # script the package ships (node recover.js) resolves its imports too, and it
    # was the integrations/ miss that taught this project what a silently-incomplete
    # script costs. A tree staged from a sibling project (extraTrees) is checked
    # through the imports that reach it, not file by file: its own helpers are
    # deliberately not all staged. Bare specifiers are covered by the node_modules
    # copy above.
    if [ ! -f ${libDir}/${entry} ]; then
      echo "opengym-package (${pname}): entry '${entry}' is not in the package" >&2
      exit 1
    fi

    # The walk compares file identity, not spelling: canonicalize every file it
    # accepts, or "a/./b" and "a/b" would both keep arriving as new files and the
    # walk would never end (the api/ import graph is cyclic, so it would).
    canon() {
      cdir=$(cd "$(dirname "$1")" 2>/dev/null && pwd -P)
      if [ -n "$cdir" ]; then
        echo "$cdir/$(basename "$1")"
      else
        echo "$1"
      fi
    }

    # The roots: the entry, plus every staged source file under the package's own
    # tree (node_modules pruned). A file the package ships but the wrapper never
    # boots — a standalone script someone runs by hand — must resolve its imports
    # just the same; that coverage is what the whole-tree scan had, and it is kept
    # deliberately while the borrowed trees stay import-reachable-check only.
    worklist=$(canon ${libDir}/${entry})
    while IFS= read -r f; do
      worklist="$worklist $(canon "$f")"
    done < <(find ${libDir} -path '*/node_modules' -prune -o \( -name '*.js' -o -name '*.mjs' \) -print)
    seen=" "
    failed=0
    while [ -n "$worklist" ]; do
      next=""
      for file in $worklist; do
        case $seen in
          *" $file "*) continue ;;
        esac
        seen="$seen $file "
        dir=$(dirname "$file")
        while IFS= read -r spec; do
          resolved=no
          for cand in "$dir/$spec" "$dir/$spec.js" "$dir/$spec.mjs" "$dir/$spec/index.js" "$dir/$spec/index.mjs"; do
            if [ -f "$cand" ]; then
              resolved=$cand
              break
            fi
          done
          if [ "$resolved" = no ]; then
            echo "opengym-package (${pname}): '$spec' imported by ''${file#${libDir}/} is not in the package" >&2
            failed=1
          else
            next="$next $(canon "$resolved")"
          fi
        done < <(grep -ohE "(from[[:space:]]+|import[[:space:]]*\(?[[:space:]]*)['\"]\.[^'\"]+['\"]" "$file" | sed -E "s/.*['\"](\.[^'\"]+)['\"].*/\1/" | sort -u)
      done
      worklist=$next
    done

    if [ "$failed" != 0 ]; then
      echo "opengym-package (${pname}): a module the package ships does not resolve — it would boot as ERR_MODULE_NOT_FOUND" >&2
      exit 1
    fi

    mkdir -p $out/bin
    makeWrapper ${nodejs_22}/bin/node $out/bin/${pname} \
      --add-flags "${libDir}/${entry}" \
      --set NODE_ENV production

    runHook postInstall
  '';

  meta = with lib; {
    inherit description;
    homepage = "https://gitlab.com/DuarteSantos8/opengym";
    license = licenses.agpl3Plus;
    platforms = nodejs_22.meta.platforms;
  };
}
