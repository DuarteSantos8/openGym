/** Read optional operator configuration without exposing invalid input in logs. */
export function connectorOrigin(value) {
  if (!value) return '';
  if (!/^https:\/\/[^\s\\/@?#]+\/?$/i.test(value) || !URL.canParse(value)) {
    throw new Error('MCP_PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, query or fragment');
  }
  return new URL(value).origin;
}
