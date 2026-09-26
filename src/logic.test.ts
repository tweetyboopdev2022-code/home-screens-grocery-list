import { describe, it, expect } from 'vitest';
import { plain, tidy, isOnList, pushRecent, quickPicks, suggest } from './logic';
const L = (...n: string[]) => n.map((c, i) => ({ id: String(i), content: c }));
describe('grocery logic', () => {
  it('plain/tidy', () => { expect(plain('[Milk](http://x)')).toBe('Milk'); expect(tidy('  2 l   milk ')).toBe('2 l milk'); });
  it('dupes ignore case/accents', () => expect(isOnList(L('Crème fraîche'), 'creme fraiche')).toBe(true));
  it('recent dedupe', () => expect(pushRecent(['Eggs', 'Milk'], 'milk')).toEqual(['Milk', 'Eggs']));
  it('quick picks skip list items', () => expect(quickPicks(['Eggs'], ['Milk', 'Eggs', 'Bread'], L('Bread'), 5)).toEqual(['Eggs', 'Milk']));
  it('suggest prefix first', () => expect(suggest('ba', ['Bread', 'Bananas', 'Kebab sauce', 'Bacon'], [], 3)).toEqual(['Bananas', 'Bacon', 'Kebab sauce']));
});
import { filterByLabels, parseLabels } from './logic';
describe('label filter', () => {
  const T = [{ id: '1', content: 'Milk', labels: ['IGA'] }, { id: '2', content: 'Paper towels', labels: ['costco'] }, { id: '3', content: 'Pepsi', labels: [] }];
  it('by label, case-insensitive', () => expect(filterByLabels(T, parseLabels('Costco'), false).map((t) => t.id)).toEqual(['2']));
  it('with unlabelled', () => expect(filterByLabels(T, ['IGA'], true).map((t) => t.id)).toEqual(['1', '3']));
  it('no filter = all', () => expect(filterByLabels(T, [], false).length).toBe(3));
});
