# Miniapp I18N Guideline

## Scope

This guideline applies to every new miniapp page, component, API adapter, mock payload, and UI state.

## Core Rules

1. All fixed UI copy must go through `i18n`.
2. Do not render `merchant.name`, `product.nameZh`, `category.nameZh`, or `productNameZhSnapshot` directly in templates.
3. Do not use Chinese characters as icons.
4. Always verify `zh`, `vi`, and `en` before merging UI work.

## Required Helpers

Use the shared helpers in [src/i18n/index.ts](/Users/peter/Desktop/HuayueLife-MVP/apps/miniapp/src/i18n/index.ts):

- `localizedName(entity, locale)`
- `localizedText(entity, locale, keys?)`
- `merchantName(entity, locale)`
- `productName(entity, locale)`
- `productSubtitle(entity, locale)`
- `productSnapshotName(snapshot, locale)`
- `categoryName(entity, locale)`

## Usage Rules

### Merchant names

Never do this:

```ts
merchant.name
merchant.nameZh
order.merchantName
```

Do this:

```ts
merchantName(merchant, locale)
```

### Product names

Never do this:

```ts
product.nameZh
item.productNameZhSnapshot
```

Do this:

```ts
productName(product, locale)
productSubtitle(product, locale)
productSnapshotName(item, locale)
```

### Descriptions, notices, text blocks

Use:

```ts
localizedText(entity, locale)
```

Use custom keys when the API uses different field names.

## Supported Field Shapes

Helpers already support these shapes:

- `nameZh`, `nameVi`, `nameEn`
- `zhName`, `viName`, `enName`
- `name_zh`, `name_vi`, `name_en`
- `titleZh`, `titleVi`, `titleEn`
- `title_zh`, `title_vi`, `title_en`
- `descriptionZh`, `descriptionVi`, `descriptionEn`
- `description_zh`, `description_vi`, `description_en`
- `localizedName.zh | vi | en`
- `localizedText.zh | vi | en`
- `translations.zh.name | title | description`
- `translations.vi.name | title | description`
- `translations.en.name | title | description`

## Fallback Order

- `zh`: Chinese -> Vietnamese -> English -> raw `name/title/description`
- `vi`: Vietnamese -> English -> Chinese -> raw `name/title/description`
- `en`: English -> Vietnamese -> Chinese -> raw `name/title/description`

Do not return blank text if any fallback exists.

## Mock Data and Fallback Dictionaries

If the backend does not provide `nameVi` or `nameEn` yet:

1. Keep UI copy localized.
2. Use helper fallback behavior.
3. Add common merchant or product fallback dictionary entries when needed.
4. Do not change API contracts or database schema for frontend-only i18n work.

## Icon Rule

Forbidden:

- `icon: '单'`
- `iconText: label.slice(0, 1)`
- `fallbackIcon: firstChar(label)`
- `avatar: '城'`

Exception:

- User avatar initial fallback is allowed.
- When using nickname initials for avatar fallback, add:
  - `<!-- i18n-check-allow avatar-initial -->` in templates
  - or an equivalent nearby line comment in script code
- This exception only applies to user avatars, not functional entry icons.

Allowed:

- emoji
- SVG
- iconfont
- uni-icons
- fixed icon keys

Recommended fallbacks:

- Orders: `🧾`
- Profile: `👤`
- City / address: `📍`
- Payment: `💳`
- Merchant / dining: `🍽️`
- Cart: `🛒`
- Chat: `💬`
- Notices: `🔔`
- Favorites: `❤️`
- Settings: `⚙️`

Note:

- The `鲜` mark in the home banner and menu hero is a brand decoration, not a functional icon.

## Validation Checklist

Before merging:

1. Switch app language to `zh`, `vi`, `en`.
2. Check merchant names on home, favorites, orders, messages, merchant detail, menu.
3. Check product names on menu, product detail, cart, checkout, order detail.
4. Check empty states and entry icons for Chinese character icons.
5. Check toast / modal copy for hardcoded Chinese.

## Commands

Run:

```bash
corepack pnpm --filter @huayue-life/miniapp typecheck
corepack pnpm --filter @huayue-life/miniapp build:mp-weixin
corepack pnpm --filter @huayue-life/miniapp check:i18n
```

`check:i18n` is a review aid. It should not block build by default, but every match must be reviewed.

## check:i18n Notes

- `check:i18n` ignores `src/i18n/index.ts`.
- `check:i18n` does not report `showToast` / `showModal` calls already wrapped by:
  - `checkoutText(...)`
  - `t(...)`
  - `translateApiError(...)`
  - locale conditional branches such as `locale.value === 'vi' ? ... : ...`
- `check:i18n` ignores avatar initial fallback only when `i18n-check-allow avatar-initial` is present nearby.
