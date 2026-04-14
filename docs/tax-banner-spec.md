# TaxModuleBanner — Design Specification

## Inspiration
Stripe Dashboard feature cards, Apple Pay settings toggle, iOS premium settings.

## Container
- Background: #0F0F0A (warm near-black)
- Border radius: 16px
- Padding: 20px
- Border: 1px
  - Active: #B8952A (gold) + gold shadow (opacity 0.15, radius 12)
  - Inactive: #1F1F1F (subtle border)
- Gap between sections: 14px

## Header Row (flex row, align center)
- Icon: receipt-outline in 44x44 circle
  - Active: bg rgba(184,149,42,0.15), color #B8952A
  - Inactive: bg #1A1A1A, color #505050
- Title: "Modulo Tributario" — 16px, weight 800, #F5F5F5
- Subtitle: 12px, #707070
- Custom switch (right-aligned)

## Custom Switch (no native Switch)
- Track: 52x28, borderRadius 14
  - Active: #B8952A
  - Inactive: #1F1F1F
- Thumb: 24x24 circle
  - Active: #FFFFFF, translateX 24
  - Inactive: #505050, translateX 2
- Animation: Animated.spring (damping 16, stiffness 180)

## Status Badge
- Active: green tint bg, green border, "Activo — Puedes emitir boletas y descargar PDFs"
- Inactive: grey tint bg, dark border, "Inactivo — Activa para gestionar tus impuestos"
- Padding: 14h x 10v, borderRadius 10

## Credential Warning (active + no credentials)
- Orange tint background
- alert-circle-outline icon
- "Configura tus credenciales SII en Gestion"

## Footer (inactive only)
- Italic, 11px, #505050
- "Puedes activarlo en cualquier momento. Tus datos se conservan."
