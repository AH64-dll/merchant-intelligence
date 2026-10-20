import { describe, expect, it } from 'vitest';
import { DirectoryQueryValidationError, normalizeDirectoryQuery } from './directory';
import { directoryPageInput } from './directory-page';

describe('directoryPageInput — repeated params match the list API', () => {
  it.each([
    [{ page: ['1', '2'] }, 'page'],
    [{ category: ['a', 'b'] }, 'category'],
    [{ governorate: ['g1', 'g2'] }, 'governorate'],
    [{ coverage: ['none', 'broad'] }, 'coverage'],
  ])('forwards repeated params %j so the selector rejects them', (params, field) => {
    const input = directoryPageInput(params, 'all');
    expect(() => normalizeDirectoryQuery(input)).toThrowError(DirectoryQueryValidationError);
    try {
      normalizeDirectoryQuery(input);
    } catch (error) {
      expect(error).toMatchObject({ field });
    }
  });

  it('drops empty single values but forwards non-empty single values unchanged', () => {
    expect(directoryPageInput({ category: '' }, 'all')).toEqual({ view: 'all' });
    expect(directoryPageInput({ category: 'Home', page: '2' }, 'all')).toEqual({
      view: 'all',
      page: '2',
      category: 'Home',
    });
  });
});
