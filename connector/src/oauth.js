// RFC 9728 protected-resource + RFC 8414 authorization-server metadata.
export function discovery({ origin, prefix }) {
  const issuer = `${origin}${prefix}`
  return {
    issuer,
    mcpUrl: `${issuer}/mcp`,
    resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
    protectedResource: {
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
    },
    authorizationServer: {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      // ponytail: non-standard hint; refresh tokens are single-use (public client). Behaviour lands with /token.
      refresh_token_rotation: true,
    },
  }
}
