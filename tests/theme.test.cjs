const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { watchTheme, modeColors } = require('../miniprogram/utils/theme');

test('native bars use valid light/dark variables including the custom scanner status area', () => {
  const app = JSON.parse(fs.readFileSync('miniprogram/app.json'));
  assert.equal(app.darkmode, true);
  const themes = JSON.parse(fs.readFileSync('miniprogram/' + app.themeLocation));
  const page = JSON.parse(fs.readFileSync('miniprogram/pages/receive/index.json'));
  for (const theme of Object.values(themes)) {
    for (const value of Object.values({ ...app.window, ...page })) {
      if (typeof value === 'string' && value.startsWith('@')) assert.ok(theme[value.slice(1)], 'undefined theme variable ' + value);
    }
  }
  assert.equal(themes.dark.navigationText, 'white');
  assert.equal(themes.light.navigationText, 'black');
});

test('slider theme follows runtime changes and releases its listener on leaving More', () => {
  const page = { update(values) { this.data = values; } };
  let listener, removed;
  const stop = watchTheme(page, { getAppBaseInfo: () => ({ theme: 'dark' }),
    onThemeChange(fn) { listener = fn; }, offThemeChange(fn) { removed = fn; } });
  assert.deepEqual(page.data, modeColors('dark'));
  listener({ theme: 'light' }); assert.deepEqual(page.data, modeColors('light'));
  stop(); assert.equal(removed, listener);
  assert.doesNotThrow(() => watchTheme(page, {}));
});
