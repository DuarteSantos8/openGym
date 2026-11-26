// Which edition this build is (docs/next/adr/0008-cloud-edition.md).
//
//   default  what everyone gets unless they ask otherwise: self-hosted, offline, the demo. No
//            third-party runtime calls, no paid tier, every feature unlocked.
//   cloud    the hosted service only, built with VITE_EDITION=cloud: accounts through the hosted
//            auth provider and an optional Pro tier (ADR 0010, ADR 0011).
//
// THE RULE: cloud code is reached only through a dynamic import behind isCloud(), like this:
//
//     if (isCloud()) { const { loadEntitlement } = await import('./cloud/entitlement.js') … }
//
// so the default build never carries it. This file is the one piece both builds ship, which is
// why it names no provider and no address: lib/edition.test.js keeps it that way.

/** 'cloud' or 'default', from a build's environment. Anything but the exact word is the default. */
export const editionOf = env => (env && env.VITE_EDITION === 'cloud' ? 'cloud' : 'default')

export const EDITION = editionOf(import.meta.env)

export const isCloud = () => EDITION === 'cloud'

/**
 * Whether a paid feature is available. In the default edition everything is: there is no paid
 * tier to check. In the cloud edition it is what the account's entitlement says
 * (lib/cloud/entitlement.js hasFeature), handed in by the caller so this stays free of cloud code.
 */
export const featureAvailable = (feature, entitled = () => false, edition = EDITION) =>
  edition !== 'cloud' || !!entitled(feature)
