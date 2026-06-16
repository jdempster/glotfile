import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en-gb', 'fr-fr'],
  defaultLocale: 'en-gb',
});
