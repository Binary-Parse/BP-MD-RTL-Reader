/**
 * Executable locale lookup policy, kept separate from the large translation
 * catalog so mutation testing can exercise behavior without mutating prose.
 */
export function translate(messages, key, locale = 'en') {
  const table = messages[locale] || messages.en;
  if (key in table) return table[key];
  if (key in messages.en) return messages.en[key];
  return key;
}

export function localeDirection(locale) {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
