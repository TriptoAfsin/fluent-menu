import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const mix = (a: number[], b: number[], t: number) =>
  "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");

/** Builds a 16-step brand ramp around the Windows accent color (shade 80 = accent). */
export function brandFromAccent(accent: string): BrandVariants {
  const rgb = hexToRgb(accent);
  const ramp: Record<number, string> = {};
  for (let step = 10; step <= 160; step += 10) {
    const t = (step - 80) / 80;
    ramp[step] = t < 0 ? mix(rgb, [0, 0, 0], -t * 0.82) : mix(rgb, [255, 255, 255], t * 0.82);
  }
  return ramp as unknown as BrandVariants;
}

/**
 * Fluent theme tinted with the Windows accent. Surface tokens stay opaque so menus,
 * dialogs and toasts are solid; the translucent Mica layers live in styles.css.
 */
export function makeTheme(dark: boolean, accent: string): Theme {
  const brand = brandFromAccent(accent);
  const theme = dark ? createDarkTheme(brand) : createLightTheme(brand);
  if (dark) {
    theme.colorBrandForeground1 = brand[110];
    theme.colorBrandForeground2 = brand[120];
    theme.colorBrandForegroundLink = brand[120];
  }
  return theme;
}
