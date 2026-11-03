{
  pkgs,
  callPackage ? pkgs.callPackage,
}:

let
  # The release version is whatever api/package.json says — the same file release:preflight
  # checks a v* tag against, so the Nix packages can never drift from the release they ship.
  version = (builtins.fromJSON (builtins.readFile ../../api/package.json)).version;

  # …but the MCP server does not ship with the API: it is released on its own cadence and
  # reports its version independently, so it takes mcp/package.json's instead.
  mcpVersion = (builtins.fromJSON (builtins.readFile ../../mcp/package.json)).version;
in
{
  opengym-frontend = callPackage ./frontend.nix { inherit version; };
  opengym-api = callPackage ./api.nix { inherit version; };
  opengym-mcp = callPackage ./mcp.nix { version = mcpVersion; };
}
