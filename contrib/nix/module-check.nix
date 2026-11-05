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
    if scenario ? failsToEvaluate then
      if checkFails then
        [ "${scenario.label} :: expected this configuration to fail evaluation, but it evaluated" ]
      else
        [ ]
    else
      map reportOne scenario.expect;

  failures = joinFailures (lib.concatMap reportScenario scenarios);
in
pkgs.runCommand name
  {
    passAsFile = [ "failures" ];
    inherit failures;
  }
  ''
    if [ -s "$failuresPath" ]; then
      echo "opengym module check failed:" >&2
      cat "$failuresPath" >&2
      exit 1
    fi
    touch $out
  ''
