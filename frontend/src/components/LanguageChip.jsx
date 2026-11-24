// The language, right on the first screen (#1037): the phone apps' welcome screen and the web's
// sign-in screen. Preselected from the device (the language already on screen), one tap opens the
// same list as Settings → Language. The pick belongs to this device until a profile picks its own
// in Settings (lib/default-lang.js rememberLangPick), so a guest's choice never overwrites the
// language of an account that signs in afterwards.
import { useStore } from '../store/useStore.js'
import { t, LANGS, INSTR_LANGS, getLang, setLang, baseLang, useLang } from '../lib/i18n.js'
import { rememberLangPick } from '../lib/default-lang.js'
import { openSelectSheet, Button } from './ui.jsx'

/** Settings → Language's choices: every pack by its own name, and a note where instructions stay English. */
export const languageOptions = () => Object.entries(LANGS).map(([k, name]) => ({
  value: k, label: name,
  subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't translated into this language yet, so they stay in English."),
}))

export default function LanguageChip() {
  useLang()
  const S = useStore(s => s.S)
  const cur = getLang()
  const pick = v => {
    rememberLangPick(v)
    setLang(v, S?.enParens?.[baseLang(v)] ?? true, S?.enOnly?.[baseLang(v)] === true)
  }
  return <Button size="sm" icon="globe" trailingIcon="chevronDown" className="lang-chip"
    aria-haspopup="dialog" aria-label={t('Language') + ': ' + (LANGS[cur] || cur)}
    onClick={() => openSelectSheet({ title: t('Language'), value: cur, options: languageOptions(), onChange: pick })}>
    {LANGS[cur] || cur}
  </Button>
}
