// Lets non-component modules (sheet flows) navigate. App registers the router's navigate.
let _nav = () => {}
export const setNav = fn => { _nav = fn }
export const nav = to => _nav(to)
