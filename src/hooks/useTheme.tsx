import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark";
export const ACCENTS = {
  indigo: { label: "Indigo", brand: "#4f46e5", accent: "#38bdf8" },
  emerald: { label: "Emerald", brand: "#059669", accent: "#34d399" },
  navy: { label: "Navy", brand: "#1e3a8a", accent: "#60a5fa" },
  violet: { label: "Violet", brand: "#7c3aed", accent: "#e879f9" },
  rose: { label: "Rose", brand: "#e11d48", accent: "#fb923c" },
} as const;
export type AccentKey = keyof typeof ACCENTS;

interface ThemeState {
  mode: ThemeMode;
  accent: AccentKey;
  setMode: (m: ThemeMode) => void;
  setAccent: (a: AccentKey) => void;
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("light");
  const [accent, setAccent] = useState<AccentKey>("indigo");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const m = localStorage.getItem("scdms-theme");
    const a = localStorage.getItem("scdms-accent");
    if (m === "dark" || m === "light") setMode(m);
    if (a && a in ACCENTS) setAccent(a as AccentKey);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
    root.style.setProperty("--color-brand", ACCENTS[accent].brand);
    root.style.setProperty("--color-accent", ACCENTS[accent].accent);
    localStorage.setItem("scdms-theme", mode);
    localStorage.setItem("scdms-accent", accent);
  }, [mode, accent, ready]);

  return (
    <ThemeContext.Provider value={{ mode, accent, setMode, setAccent }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
