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
- A customer review must be tied to a real, completed, non-voided order owned by that customer. Each order can create at most one review.
- The first review release supports a required 1-5 overall rating, optional text, up to six images, and an optional anonymous display mode.
- Reviews are accepted for seven days after order completion and are published immediately unless hidden by platform moderation in the future.
- Public rating summaries and review counts must be calculated from stored, visible reviews. They must never be fabricated.
- The product does not currently include online payment, riders, coupons, points, review rewards, review likes, or social following.

## Brand Commitments

The product name is YunQiao Life / 云桥 Life. The Mini Program remains light, young, comfortable, food-oriented, and familiar to WeChat users. It may follow the information efficiency of Meituan or Ele.me without adopting a red platform identity.

## Evidence on Hand

The repository contains real merchant, menu, capability, order, user-profile, and image-upload flows. It has no existing merchant-review data; new public rating content must therefore remain empty until customers submit real reviews.

## Product Principles

- Real transactions before social volume.
- Fast ordering and clear status before decorative complexity.
- Public information must be explainable from stored data.
- New features must preserve all existing ordering and QR safety gates.
- Every customer-facing state must work in Chinese, Vietnamese, and English.
