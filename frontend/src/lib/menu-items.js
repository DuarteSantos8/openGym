// Every row a menuSheet would show, in order, the ones folded under "More" included
// (sheets.jsx MenuSheet: `items`, or `sections` of { title, items } and { more: [sections] }).
// Falsy rows are dropped, as the sheet drops them. For code and tests that look a row up by label.
export function menuItemsOf(menu) {
  const flat = list => (list || []).flatMap(g => g.more ? flat(g.more) : (g.items || []))
  return (menu.sections ? flat(menu.sections) : menu.items || []).filter(Boolean)
}
