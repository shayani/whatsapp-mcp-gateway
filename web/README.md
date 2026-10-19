# Web interface languages

English is the default. The header language selector offers only **English** and
**Português (Brasil)**. Switching updates the interface immediately and saves the
choice in this browser under `whatsapp-gateway.language`. Invalid or unavailable
saved preferences fall back to English; blocked storage does not prevent switching
for the current session.

`src/i18n.tsx` provides the language context, date locale, and typed translation
function. English source strings are the keys in `src/translations.ts`, which holds
the Brazilian Portuguese translations. Use named `{placeholders}` for dynamic
values and pass the active locale to date formatters. Contact names, messages,
transcriptions, and filenames are user data and must not be translated.

Validation:

```sh
npm ci
npm test
npm run build
```

Tests render the interface and modals in both languages and check default/fallback
behavior, saved preferences, unavailable storage, unchanged user content, and
translation placeholders. The server-rendering tests may report React's expected
`useLayoutEffect` warning for the client-only message view; they do not constitute
visual browser testing.
