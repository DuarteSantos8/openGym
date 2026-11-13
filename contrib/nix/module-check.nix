# Where the NixOS module's eval-level checks are stated as scenarios.
#
# The check used to be a shell ladder: three full system evaluations plus ~20
# `check_eq` stanzas that reached into the evaluated config through
# string-interpolated paths —
# `testConfig.config.systemd.services.opengym-api.environment.MY_FLAG or "missing"`.
# Its interface — add a scenario, assert a fact — was hand-built shell, so a new
# option shipped with no coverage unless someone remembered to write a stanza, and
# the ladder never touched mcp.enable, environmentFile, the hardening sandbox, a
# custom dataDir, the nginx TLS path, or the removed-option modules. It also
# asserted one line at a time, each failure a string mismatch at the bottom of a
# build log.
#
# The interface is now a list of scenarios — a config plus its expectations as
# predicates over the evaluated config, or the demand that a config fails to
# evaluate. The implementation evaluates each scenario's system once (not once per
# expectation — the config is a single thunk shared by them all), collects every
# failure and reports them together in one check derivation, so adding coverage is
# an attrset instead of a stanza.
{
  pkgs,
  lib,
  system,
  name ? "opengym-module-check",
  scenarios,
}:

let
  # A check that passed says nothing: only failures reach the report.
  joinFailures = lines: lib.concatStringsSep "\n" (lib.filter (line: line != "") lines);

  # The evaluated config of a scenario's modules.
  evalConfig = modules: (lib.nixosSystem { inherit system modules; }).config;

  # A scenario's demand that the documentation names what the module manages. The
  # env-var contract is restated in prose more than anywhere else — the module, the
  # `nix run` script, the API itself — and a stale table sends readers to the wrong
  # source of truth. This reads the option → environment table out of the doc and
  # holds it against the variables the module actually sets.
  reportDocumented =
    scenario:
    let
      # The table: from the marker heading's line to the next heading.
      dropUntil =
        pred: lines:
        if lines == [ ] then
          [ ]
        else if pred (builtins.head lines) then
          lib.drop 1 lines
        else
          dropUntil pred (builtins.tail lines);
      takeUntilHeading =
        lines:
        if lines == [ ] then
          [ ]
        else if lib.hasPrefix "#" (builtins.head lines) then
          [ ]
        else
          [ (builtins.head lines) ] ++ takeUntilHeading (builtins.tail lines);

      config = evalConfig scenario.modules;
      # PATH is systemd's default for every unit, not the module's; the scenario's
      # config sets the optional ones (defaultLang, vapidSubject, adminUids,
      # coachJobTimeoutSeconds, allowedPrivateIps) so this
      # sees every variable the module can put on the unit.
      vars = lib.filter (name: name != "PATH") (
        builtins.attrNames config.systemd.services.opengym-api.environment
      );
      table = lib.concatStringsSep "\n" (
        takeUntilHeading (
          dropUntil (line: lib.hasInfix "Option → environment mapping" line) (
            lib.splitString "\n" (builtins.readFile scenario.doc)
          )
        )
      );
      # The table spells every variable as a code span (`PORT`, `DEFAULT_LANG`), and the
      # check looks for exactly that: a substring match would pass on a longer name
      # that happens to contain a shorter one.
      missing = lib.filter (name: !(lib.hasInfix "`${name}`" table)) vars;
    in
    if missing == [ ] then
      [ ]
    else
      [ "${scenario.label} :: the docs' option → environment table does not name: ${toString missing}" ];

  # Walk an option path under services.opengym, so a removed-option scenario can
  # name the option instead of spelling the whole path through the config.
  optionValue =
    config: path: builtins.foldl' (value: name: value.${name}) config.services.opengym path;

  reportScenario =
    scenario:
    let
      # The config is evaluated once per scenario — every expectation (and the
      # failure proof) reads this one thunk.
      config = evalConfig scenario.modules;

      # One expectation: { label = "..."; ok = config: true | "..."; } — true passes;
      # false is reported bare, a string is reported as the reason.
      reportOne =
        expect:
        let
          result = expect.ok config;
        in
        if result == true then
          ""
        else if builtins.isBool result then
          "${scenario.label} :: ${expect.label}: expected to hold"
        else
          "${scenario.label} :: ${expect.label}: ${result}";

      # A configuration that must NOT evaluate. The module says no in two ways, and
      # each demand names the cheap proof for the way it uses:
      #   true            — its own assertions (mutually exclusive options,
      #                     contradictory combinations), which are only checked
      #                     once the system's toplevel is forced
      #                     (nixos/modules/misc/assertions.nix, applied at
      #                     system.build.toplevel);
      #   [ "media" "imageRoot" ]
      #                   — a removed option still set, whose value throws as soon
      #                     as it is read (mkRemovedOptionModule's apply).
      checkFails =
        if scenario.failsToEvaluate == true then
          (builtins.tryEval config.system.build.toplevel.drvPath).success
        else
          (builtins.tryEval (optionValue config scenario.failsToEvaluate)).success;
    in
    if scenario ? doc then
      reportDocumented scenario
    else if scenario ? failsToEvaluate then
      if checkFails then
        [ "${scenario.label} :: expected this configuration to fail evaluation, but it evaluated" ]
      else
        [ ]
    else
      map reportOne scenario.expect;

  failures = joinFailures (lib.concatMap reportScenario scenarios);

  # The checked docs ride in the derivation's environment as store paths, so the check
  # has them as inputs: a check that read its doc without depending on it would keep
  # passing while the file changed under it.
  docPaths = lib.concatMapStringsSep " " (s: "${s.doc}") (lib.filter (s: s ? doc) scenarios);
in
pkgs.runCommand name
  {
    passAsFile = [ "failures" ];
    inherit failures docPaths;
  }
  ''
    if [ -s "$failuresPath" ]; then
      echo "opengym module check failed:" >&2
      cat "$failuresPath" >&2
      exit 1
    fi
    touch $out
  ''
