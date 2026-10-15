import { dateLocale, t } from '../lib/i18n.js'
import { OFF_COUNTRIES, OFF_LANGUAGES } from '../lib/nutrition/settings-lists.js'
import { settingOf, useNtSettings } from '../lib/nutrition/use-nt-settings.js'
import { Section } from './ui.jsx'
import NtChoiceRow from './NtChoiceRow.jsx'
import NtSwitchRow from './NtSwitchRow.jsx'

// A language or country by name in the app's language; the code itself where the platform has
// no name for it.
function displayName(type, code) {
  try { return new Intl.DisplayNames([dateLocale()], { type }).of(code) || code } catch { return code }
}

// Profile › Food sources (ia-proposal §5; NutriTrace Settings › Connected services, the Open Food
// Facts part): whether the Open Food Facts search is on (the food search, the Foods page's Online
// tab and barcode lookups), and the language and country it uses (names, and which products come
// first). Logins and keys are not settings the hub lets through, USDA cannot be used through it
// (no key can be saved), and Gains imports every product per 100 g, so none of those has a row.
export default function FoodSourcesSettings() {
  const { data } = useNtSettings()
  const country = code => (OFF_COUNTRIES[code] ? displayName('region', OFF_COUNTRIES[code]) : t('Worldwide'))
  return (
    <Section title={t('Open Food Facts')} footer={t('The free, open food database behind the online results and the barcode scanner.')}>
      <NtSwitchRow k="offEnabled" icon="globe" tint="var(--teal)" title={t('Search Open Food Facts')}
        subtitle={t('Online results when you add a food, and barcode lookups.')} />
      {settingOf(data, 'offEnabled') && <>
        <NtChoiceRow k="offSearchLanguage" icon="chat" tint="var(--blue)" title={t('Search language')}
          options={OFF_LANGUAGES.map(code => ({ value: code, label: displayName('language', code) }))} />
        <NtChoiceRow k="offSearchCountry" icon="flag" tint="var(--orange)" title={t('Search country')}
          options={Object.keys(OFF_COUNTRIES).map(name => ({ value: name, label: country(name) }))}
          search={{ placeholder: t('Search…'), label: t('Search country'), emptyLabel: t('No match'), match: (o, q) => o.label.toLowerCase().includes(q.trim().toLowerCase()) }} />
      </>}
    </Section>
  )
}
