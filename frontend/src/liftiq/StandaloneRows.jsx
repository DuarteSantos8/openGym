// LIFTIQ-FORK: settings rows and about text of the standalone flavour (VITE_STANDALONE=1).
// Plain English on purpose: upstream's CI checks every t('...') key against the 25 locale packs,
// and these few fork-only lines are not worth 25 translations (the media attribution beside them
// is untranslated in the same way).
import { Row } from '../components/ui.jsx'
import { FORK_BRANCH_URL, UPSTREAM_REPO } from './fork.js'

export function StandaloneAccountRows() {
  return <>
    <Row icon="lock" iconTint="var(--acc)" title="All data stays in this browser"
      subtitle="No account, no server. Back it up anytime in Data & backup." />
  </>
}

// The AGPL-3.0 source offer plus the credit to upstream, shown in place of the upstream link.
export function StandaloneSource() {
  return <>
    <a href={FORK_BRANCH_URL} target="_blank" rel="noopener">Source code (this fork)</a><br />
    Non-commercial fork of <a href={UPSTREAM_REPO} target="_blank" rel="noopener">openGym</a> by Duarte Santos
    (AGPL-3.0-or-later), with LiftIQ sensor integration (in development).
  </>
}
