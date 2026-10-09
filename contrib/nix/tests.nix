# Integration test: boots a NixOS VM with the openGym module (full stack: API + optional
# module-managed nginx vhost + the exercise media shipped in the frontend package) and
# exercises the HTTP contract end to end.
#
# Used through the flake's `checks.opengym-nixos-test` (runs on `nix flake check`) and the
# conventional `nixosTests.opengym` output.
{
  pkgs,
  modules,
}:

pkgs.testers.runNixOSTest {
  name = "opengym";

  nodes.machine =
    { pkgs, ... }:
    {
      imports = modules;

      services.opengym = {
        enable = true;
        rpId = "localhost";
        origin = "http://localhost:8080";
        nginx.enable = true; # exercise the module-managed vhost path
      };

      system.stateVersion = "25.05";
      environment.systemPackages = [ pkgs.curl ];
    };

  testScript = ''
    start_all()

    machine.wait_for_unit("opengym-api.service")
    machine.wait_for_open_port(3000)

    direct = machine.succeed("curl -fsS http://127.0.0.1:3000/api/health")
    machine.log(f"[direct] {direct}")
    assert '"ok":true' in direct, f"unexpected /api/health body: {direct}"

    machine.wait_for_unit("nginx.service")
    machine.wait_for_open_port(80)

    via_nginx = machine.succeed("curl -fsS http://localhost/api/health")
    machine.log(f"[via nginx] {via_nginx}")
    assert '"ok":true' in via_nginx, f"nginx proxy returned: {via_nginx}"

    spa = machine.succeed("curl -fsS http://localhost/")
    assert 'id="root"' in spa, "SPA index.html not served by nginx root"

    # The exercise media ship inside the frontend package (catalogue/media), no download involved.
    machine.succeed("curl -fsS -o /dev/null http://localhost/exercise-media/NOTICE.md")
    # Licensed for openGym only: another site cannot embed them.
    corp = machine.succeed("curl -fsSI http://localhost/exercise-media/NOTICE.md")
    assert "cross-origin-resource-policy: same-origin" in corp.lower(), f"no CORP header: {corp}"
  '';
}