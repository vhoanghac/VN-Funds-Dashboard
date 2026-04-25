# Design System — Funds Dashboard

Inspired by **Claude / Anthropic** visual language.
Source reference: `C:\Users\vohoa\Desktop\claudedesign.md`

---

## CSS Variables (src/index.css)

```css
:root {
  /* Brand */
  --color-primary:        #c96442;  /* Terracotta — main CTA, accents */
  --color-primary-dark:   #a8512f;  /* Darker terracotta — hover, strong text */
  --color-primary-fg:     #faf9f5;  /* Light text on terracotta buttons */
  --color-primary-light:  #fdf0ea;  /* Terracotta hint backgrounds */
  --color-primary-border: #f0cfc0;  /* Terracotta hint borders */

  /* Semantic data */
  --color-secondary: #b53333;  /* Error / loss red */
  --color-portfolio: #0ECB81;  /* Crypto Green — portfolio gains */
  --color-winner:    #0ECB81;  /* Best-in-class highlight */
  --color-baseline:  #87867f;  /* Stone Gray — baseline / benchmark line */

  /* Backgrounds */
  --color-bg:      #f5f4ed;  /* Parchment — page background */
  --color-surface: #faf9f5;  /* Ivory — cards, panels */

  /* Text */
  --color-text:       #141413;  /* Anthropic Near Black */
  --color-text-muted: #5e5d59;  /* Olive Gray — secondary text */

  /* Borders */
  --color-border:        #e8e6dc;  /* Warm Border — standard */
  --color-border-subtle: #f0eee6;  /* Border Cream — very faint */

  /* Shape & Elevation */
  --radius: 8px;
  --shadow: rgba(0,0,0,0.05) 0px 4px 24px;  /* Whisper shadow */
}
```

---

## Typography

| Role | Font | Weight | Notes |
|------|------|--------|-------|
| Headings (h1, h2, h3) | Lora (serif) | 500 | Google Fonts import |
| Body / UI | Inter (sans) | 400–600 | Google Fonts import |
| Numbers / tabular data | Inter | 500–700 | `font-variant-numeric: tabular-nums` |

Google Fonts import in `index.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:wght@500&display=swap');
```

---

## Color Roles in Practice

### UI elements
- **Active buttons / tabs**: `--color-primary` bg, `--color-primary-fg` text
- **Hover on buttons**: `--color-primary-dark` or border change to primary
- **Cards / panels**: `--color-surface` bg, `--color-border` border, `--shadow`
- **Page background**: `--color-bg` (Parchment)

### Narrative / hint blocks
- **Info / notice banners**: `--color-primary-light` bg, `--color-primary-border` border, `--color-primary` left accent
- **Takeaway boxes**: same pattern as above

### Data / semantic
- **Profit / positive**: `#0ECB81` (green) — keep as-is, it's financial data
- **Loss / negative**: `#b53333` (red) — keep as-is
- **Win rate strong**: `#dcfce7` / `#16a34a` (green) — semantic
- **Win rate medium**: `#fef9c3` / `#ca8a04` (amber) — semantic
- **Win rate weak**: `#fee2e2` / `#dc2626` (red) — semantic

> **Rule**: Data colors (green/red/amber) are semantic — they communicate financial outcomes and should never be replaced with terracotta. Only UI chrome uses the warm Claude palette.

---

## Shape Scale

| Use | Radius |
|-----|--------|
| Pills / tags | `999px` |
| Standard cards, buttons | `8px` (--radius) |
| Hero blocks, feature cards | `12px` |
| Large containers | `16px` |

---

## Do / Don't

| Do | Don't |
|----|-------|
| Use Parchment `#f5f4ed` as page bg | Use pure white `#ffffff` as page bg |
| Use Ivory `#faf9f5` for card surfaces | Use cool gray `#f9fafb` |
| All grays warm-toned (`#5e5d59`, `#87867f`) | Use cool grays (`#6b7280`, `#9ca3af`) |
| Serif (Lora 500) for h1/h2/h3 | Mix bold serif with regular |
| Whisper shadow `rgba(0,0,0,0.05)` | Heavy drop shadows |
| Terracotta for CTA / primary actions | Orange, teal, or blue for brand moments |
| Keep green/red for financial data | Replace data semantic colors with terracotta |
