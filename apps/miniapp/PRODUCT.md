# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

YunQiao Life serves Chinese-speaking diners and Chinese restaurants in Bac Ninh and Bac Giang. Diners use the WeChat Mini Program to discover restaurants, scan table codes, order for dine-in, pickup, or merchant delivery, and follow their orders.

## Product Purpose

Help diners make a trustworthy restaurant choice and complete an order with as little friction as possible. Merchant information, menu data, prices, ordering availability, and customer feedback must come from real platform data.

## Positioning

A lightweight Chinese-language restaurant and ordering service for the local Bac Ninh and Bac Giang community, combining nearby discovery with the restaurant's real menu and supported fulfillment modes.

## Operating Context

The primary surface is a WeChat Mini Program built with UniApp, Vue 3, TypeScript, and Pinia. Diners often use it one-handed while choosing a restaurant, scanning a table code, ordering food, or checking a recently completed order.

## Capabilities and Constraints

- Supported ordering modes are DINE_IN, PICKUP, and DELIVERY, subject to the existing platform, merchant, capability, QR, table-token, and availability gates.
- A logged-in diner can write one direct review for each visible merchant from the merchant detail page without an order. A diner may also review each real, completed, non-voided order they own at most once.
- Both review entry points reuse the same required 1-5 overall rating, optional text, up to six images, and optional anonymous display mode.
- Order-linked reviews are accepted for seven days after order completion. Public review cards distinguish order-linked reviews from direct reviews without changing the existing order eligibility gate.
- Rating-only reviews without user text or images may publish immediately. Reviews with text or images must pass server-side rules and the applicable WeChat content-safety checks; uncertain, risky, pending, or unavailable checks remain non-public until Platform moderation resolves them.
- Public rating summaries and review counts must be calculated from stored, visible reviews. They must never be fabricated.
- The product does not currently include online payment, riders, coupons, points, review rewards, review likes, or social following.

## Brand Commitments

The product name is YunQiao Life / 云桥 Life. The Mini Program remains light, young, comfortable, food-oriented, and familiar to WeChat users. It may follow the information efficiency of Meituan or Ele.me without adopting a red platform identity.

## Evidence on Hand

The repository contains real merchant, menu, capability, order, user-profile, review, and image-upload flows. Public rating content must remain empty until users submit real reviews.

## Product Principles

- Real user submissions before social volume.
- Fast ordering and clear status before decorative complexity.
- Public information must be explainable from stored data.
- New features must preserve all existing ordering and QR safety gates.
- Every customer-facing state must work in Chinese, Vietnamese, and English.
