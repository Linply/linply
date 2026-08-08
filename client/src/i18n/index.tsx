import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { enUS, zhCN } from "date-fns/locale";
import { en, type Dictionary } from "./en";
import { zh } from "./zh";

export type Locale = "en" | "zh";

export const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
];

const DICTIONARIES: Record<Locale, Dictionary> = { en, zh };

const STORAGE_KEY = "linply:locale";
/** English is the default; a stored choice always wins over it. */
const DEFAULT_LOCALE: Locale = "en";

const isLocale = (value: unknown): value is Locale =>
  value === "en" || value === "zh";

const readStoredLocale = (): Locale => {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
};

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  // Keeps screen readers, spell-check and CJK font selection correct.
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: DICTIONARIES[locale] }),
    [locale, setLocale]
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

const useLocaleContext = () => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used inside <LocaleProvider>");
  }
  return context;
};

/** The translated dictionary for the active locale. */
export const useT = () => useLocaleContext().t;

/** date-fns locale matching the UI language, for relative timestamps. */
export const useDateLocale = () =>
  useLocaleContext().locale === "zh" ? zhCN : enUS;

/** Intl locale tag for toLocaleString-style formatting. */
export const useIntlLocale = () =>
  useLocaleContext().locale === "zh" ? "zh-CN" : "en-US";

export const useLocale = () => {
  const { locale, setLocale } = useLocaleContext();
  return { locale, setLocale };
};

export type { Dictionary };
