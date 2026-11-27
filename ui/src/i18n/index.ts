import React, { createContext, useContext, useMemo } from 'react';
import {
  LOCALE_IDS,
  LOCALE_NATIVE_LABELS,
  UI_LOCALE_IDS,
  type NovLocale,
  type ResolvedUiLocale,
} from '../../../src/core/catalog.js';
import { DE_DICT } from './locales/de.js';
import { EN_DICT } from './locales/en.js';
import { ES_DICT } from './locales/es.js';
import { FR_DICT } from './locales/fr.js';
import { JA_DICT } from './locales/ja.js';
import { KO_DICT } from './locales/ko.js';
import { ZH_CN_DICT } from './locales/zh-CN.js';
import { ZH_TW_DICT } from './locales/zh-TW.js';
import type { NovI18nContextValue, UiDictionary } from './types.js';

export type * from './types.js';
export {
  DE_DICT,
  EN_DICT,
  ES_DICT,
  FR_DICT,
  JA_DICT,
  KO_DICT,
  LOCALE_IDS,
  LOCALE_NATIVE_LABELS,
  UI_LOCALE_IDS,
  ZH_CN_DICT,
  ZH_TW_DICT,
};

export const DICTIONARIES: Record<ResolvedUiLocale, UiDictionary> = {
  en: EN_DICT,
  'zh-CN': ZH_CN_DICT,
  'zh-TW': ZH_TW_DICT,
  ja: JA_DICT,
  ko: KO_DICT,
  es: ES_DICT,
  fr: FR_DICT,
  de: DE_DICT,
};

const UI_LOCALE_SET = new Set<string>(UI_LOCALE_IDS);

function isResolvedUiLocale(value: unknown): value is ResolvedUiLocale {
  return typeof value === 'string' && UI_LOCALE_SET.has(value);
}

export function resolveUiLocale(
  pref: NovLocale | undefined,
  hostHint?: string | null,
): ResolvedUiLocale {
  if (isResolvedUiLocale(pref)) {
    return pref;
  }
  const raw =
    (hostHint && hostHint.trim()) ||
    (typeof navigator !== 'undefined' ? navigator.language : '') ||
    'en';
  const candidate = raw.trim().replace(/_/g, '-');

  if (/^zh(?:[-_](?:tw|hk|mo|hant))(?:\b|$)/i.test(candidate)) return 'zh-TW';
  if (/^zh\b/i.test(candidate)) return 'zh-CN';
  if (/^ja\b/i.test(candidate)) return 'ja';
  if (/^ko\b/i.test(candidate)) return 'ko';
  if (/^es\b/i.test(candidate)) return 'es';
  if (/^fr\b/i.test(candidate)) return 'fr';
  if (/^de\b/i.test(candidate)) return 'de';
  return 'en';
}

export function getDictionary(locale: ResolvedUiLocale): UiDictionary {
  return DICTIONARIES[locale] ?? EN_DICT;
}

export function formatMessage(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}

export const NovI18nContext = createContext<NovI18nContextValue>({
  locale: 'en',
  prefLocale: 'auto',
  dict: EN_DICT,
  t: (template, params) => (params ? formatMessage(template, params) : template),
});

export function useNovI18n(): NovI18nContextValue {
  return useContext(NovI18nContext);
}

export const NovI18nProvider: React.FC<{
  locale: ResolvedUiLocale;
  prefLocale: NovLocale;
  children: React.ReactNode;
}> = ({ locale, prefLocale, children }) => {
  const value = useMemo<NovI18nContextValue>(
    () => ({
      locale,
      prefLocale,
      dict: getDictionary(locale),
      t: (template, params) => (params ? formatMessage(template, params) : template),
    }),
    [locale, prefLocale],
  );
  return React.createElement(NovI18nContext.Provider, { value }, children);
};
