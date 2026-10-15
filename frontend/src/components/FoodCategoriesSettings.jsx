import { t } from '../lib/i18n.js'
import { categoryLabel, categoryName, removeCategory } from '../lib/nutrition/settings-lists.js'
import { settingOf, useNtSettings } from '../lib/nutrition/use-nt-settings.js'
import { Row, Section } from './ui.jsx'
import RemoveButton from './RemoveButton.jsx'
import { foodCategorySheet } from './FoodCategorySheet.jsx'

// Profile › Categories (ia-proposal §5; NutriTrace Settings › Categories): the categories a food
// can be filed under, each a name with an optional emoji label. The list is written whole, one
// write per change.
export default function FoodCategoriesSettings() {
  const { data, busy, update } = useNtSettings()
  const categories = settingOf(data, 'foodCategories')
  return (
    <Section footer={categories.length ? t('Foods are filed under a category from the food editor.') : t('No categories yet. Foods can be filed under them from the food editor.')}>
      {categories.map(c => (
        <Row key={categoryName(c)} icon="list" iconTint="var(--indigo)" title={(categoryLabel(c) + ' ' + categoryName(c)).trim()}>
          <RemoveButton label={t('Remove {0}', categoryName(c))} disabled={!!busy.foodCategories}
            onClick={() => update('foodCategories', d => ({ list: removeCategory(settingOf(d, 'foodCategories'), categoryName(c)) }))} />
        </Row>
      ))}
      <Row icon="plusCircle" iconTint="var(--green)" title={t('Add a category')} accessory="chevron" onClick={foodCategorySheet} />
    </Section>
  )
}
