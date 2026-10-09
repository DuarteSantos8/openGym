{
  pkgs,
  callPackage ? pkgs.callPackage,
}:

let
  # The release version is whatever api/package.json says — the same file release:preflight
  # checks a v* tag against, so the Nix packages can never drift from the release they ship.
  version = (builtins.fromJSON (builtins.readFile ../../api/package.json)).version;
in
{
  opengym-frontend = callPackage ./frontend.nix { inherit version; };
  opengym-api = callPackage ./api.nix { inherit version; };
  opengym-mcp = callPackage ./mcp.nix { inherit version; };
}
