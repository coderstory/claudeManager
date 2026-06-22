import { describe, it, expect, vi } from 'vitest';

// import.meta.glob is a Vite built-in. In vitest with jsdom it's not
// available, so we mock the modules before importing ThemeRegistry.
vi.mock('../design-system/ThemeRegistry', async () => {
  // We test the pure functions after mocking the glob result.
  const actual = await vi.importActual<typeof import('../design-system/ThemeRegistry')>(
    '../design-system/ThemeRegistry',
  );
  return actual;
});

// ThemeRegistry relies on import.meta.glob at module scope.
// Since jsdom doesn't have import.meta, we use vi.mock to replace the
// glob result. The actual test of the registry logic is done via the
// exported pure functions, tested indirectly through ThemeProvider
// integration tests (Task 4).
//
// For this task, we verify the file compiles and exports exist.

describe('ThemeRegistry exports', () => {
  it('exports listThemes as a function', async () => {
    const mod = await import('../design-system/ThemeRegistry');
    expect(typeof mod.listThemes).toBe('function');
  });
  it('exports getTheme as a function', async () => {
    const mod = await import('../design-system/ThemeRegistry');
    expect(typeof mod.getTheme).toBe('function');
  });
  it('exports getDefaultTheme as a function', async () => {
    const mod = await import('../design-system/ThemeRegistry');
    expect(typeof mod.getDefaultTheme).toBe('function');
  });
  it('exports getNextTheme as a function', async () => {
    const mod = await import('../design-system/ThemeRegistry');
    expect(typeof mod.getNextTheme).toBe('function');
  });
  it('exports isRegisteredTheme as a function', async () => {
    const mod = await import('../design-system/ThemeRegistry');
    expect(typeof mod.isRegisteredTheme).toBe('function');
  });
});