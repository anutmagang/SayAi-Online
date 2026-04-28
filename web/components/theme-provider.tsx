"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppTheme = "light" | "dark" | "glass";

const STORAGE_KEY = "fai-clipper-theme";

type Ctx = {
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
  mounted: boolean;
};

const ThemeContext = createContext<Ctx | null>(null);

function normalizeTheme(a: string | null): AppTheme {
  if (a === "light" || a === "dark" || a === "glass") return a;
  if (a === "elegant") return "glass";
  return "dark";
}

function readThemeFromDom(): AppTheme {
  return normalizeTheme(document.documentElement.getAttribute("data-theme"));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "elegant") localStorage.setItem(STORAGE_KEY, "glass");
      const t = normalizeTheme(raw === "elegant" ? "glass" : raw) || readThemeFromDom();
      document.documentElement.setAttribute("data-theme", t);
      setThemeState(t);
    } catch {
      setThemeState(readThemeFromDom());
    }
    setMounted(true);
  }, []);

  const setTheme = useCallback((t: AppTheme) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute("data-theme", t);
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, mounted }),
    [theme, setTheme, mounted],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const v = useContext(ThemeContext);
  if (!v) throw new Error("useAppTheme must be used within ThemeProvider");
  return v;
}
