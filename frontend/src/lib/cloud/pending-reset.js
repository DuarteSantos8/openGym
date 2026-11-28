// A reset link has been followed and the new password not yet chosen (Cloud edition, ADR 0013).
//
// The link signs the person in, and that session is kept so it outlives the page. The step they
// are on has to outlive the page too, or loading it again shows their account with the old
// password still in force. So the step is kept for the tab: it survives a reload, ends with the
// tab, and is not shared with other tabs. What is kept is the account's id and nothing else:
// never the link, never a token. It only counts for that account, so a reset left unfinished is
// never asked of whoever signs in next.
export const RESET_KEY = 'gym_cloud_reset_v1'

function tabStorage() {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

/** @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'>|null} [storage] where the step is kept; the page's own memory when it refuses */
export function createPendingReset(storage = tabStorage()) {
  let here = null
  const read = () => {
    try { const v = storage?.getItem(RESET_KEY); if (typeof v === 'string' && v) return v } catch { /* the page's memory will do */ }
    return here
  }
  const clear = () => {
    here = null
    try { storage?.removeItem(RESET_KEY) } catch { /* nothing to remove */ }
  }
  return {
    /** This account has a password to choose. */
    mark(userId) {
      if (typeof userId !== 'string' || !userId) { clear(); return }
      here = userId
      try { storage?.setItem(RESET_KEY, userId) } catch { /* the page's memory will do */ }
    },
    clear,
    /** Whether this account, and no other, has a password to choose. */
    isFor(userId) { return typeof userId === 'string' && !!userId && read() === userId },
  }
}
