/**
 * Which of the ways to confirm it is you gets the loud button, which gets a divider, and when
 * nothing here can confirm anything at all. This is the one place that order is decided, so every
 * sheet that asks "confirm it is you" (ProveOwner in components/PasswordAuth.jsx) shows the same
 * order and never renders two loud buttons at once.
 *
 * A passkey the profile has but this browser cannot use falls back exactly as it did before a
 * provider option existed: `passkey` and `webauthn` are taken apart on purpose, because a passkey
 * that exists but cannot be used here still changes which dead-end sentence applies, even though
 * it renders no button.
 *
 * @param {object} choice
 * @param {boolean} [choice.passkey] The profile has a passkey.
 * @param {boolean} [choice.webauthn] This browser can make a passkey assertion.
 * @param {boolean} [choice.password] The current password counts as proof here.
 * @param {boolean} [choice.identity] A sign-in at the provider counts as proof here.
 * @param {boolean} [choice.danger] The action this proof carries is destructive.
 * @returns {{passkey: (string|null), password: (string|null), passwordDivider: boolean,
 *   identity: (string|null), identityDivider: boolean, deadEnd: (string|null)}}
 *   `passkey`/`password`/`identity` are a button variant (`'primary'`, `'danger'` or `'plain'`)
 *   or `null` when that option does not render. `deadEnd` is `null`, `'no-passkey-here'` (a
 *   passkey exists but this browser cannot use it) or `'nothing'` (no passkey at all) - only
 *   reachable once every other option, the provider included, is also unavailable.
 */
export function proofChoices({ passkey, webauthn, password, identity, danger } = {}) {
  const withPasskey = !!passkey && !!webauthn
  const main = danger ? 'danger' : 'primary'
  const passkeyVariant = withPasskey ? main : null
  const passwordVariant = password ? (withPasskey && !danger ? 'plain' : main) : null
  const passwordDivider = !!password && withPasskey
  // The provider option is always offered last, and is loud only when it is the sole answer -
  // a full top-level navigation is the most disruptive of the three, so it only takes the loud
  // slot once the quieter options have had their turn.
  const identityVariant = identity ? ((!withPasskey && !password) ? main : 'plain') : null
  const identityDivider = !!identity && (withPasskey || !!password)
  const deadEnd = (!withPasskey && !password && !identity) ? (passkey ? 'no-passkey-here' : 'nothing') : null
  return { passkey: passkeyVariant, password: passwordVariant, passwordDivider, identity: identityVariant, identityDivider, deadEnd }
}
