import { expect, it } from 'vitest';
import { CATALOG } from '@crashing/plugin-core';
import messages from './locales/messages.json';
import site from './locales/site.json';

it('packaged panel-ui locales cover all 9 languages, every card, and every UI string', () => {
  const languages = Object.keys(site) as Array<keyof typeof site>;
  expect(languages).toEqual(['en', 'ru', 'de', 'fr', 'es', 'pl', 'lt', 'be', 'sr']);

  const messageKeys = Object.keys(messages.ru).sort();
  const slots = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

  for (const language of languages) {
    const locale = site[language];
    expect(locale.label.trim()).toBeTruthy();
    expect(locale.intlLocale.trim()).toBeTruthy();
    expect(Object.keys(locale.errors).length).toBeGreaterThan(0);

    for (const { id } of CATALOG) {
      const card = locale.cards[id as keyof typeof locale.cards];
      expect(card, `${language}: missing card ${id}`).toBeDefined();
      expect(card.effect.trim(), `${language}: empty effect for ${id}`).toBeTruthy();
      expect(card.lore.trim(), `${language}: empty lore for ${id}`).toBeTruthy();
    }

    if (language === 'en') continue;
    const langMessages = messages[language] as Record<string, string>;
    expect(Object.keys(langMessages).sort()).toEqual(messageKeys);
    for (const [source, translated] of Object.entries(langMessages)) {
      expect(translated.trim(), `${language}: ${source}`).toBeTruthy();
      expect(slots(translated), `${language}: ${source}`).toEqual(slots(source));
    }
  }
});
