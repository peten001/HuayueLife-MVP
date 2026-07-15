package com.yunqiao.life.merchantterminal.printing.receipt

import org.json.JSONObject
import java.time.Instant

enum class ReceiptType { ORDER_CUSTOMER, TABLE_BILL }

data class ReceiptMerchant(
    val id: String,
    val name: String,
    val address: String?,
    val phone: String?,
)

data class ReceiptOrder(
    val id: String,
    val orderNo: String,
    val orderType: String,
    val tableName: String?,
    val guestCount: Int?,
    val createdAt: String,
    val completedAt: String?,
)

data class ReceiptTableSession(
    val id: String,
    val sessionNo: String,
    val tableName: String,
    val openedAt: String,
    val closedAt: String?,
    val orderNos: List<String>,
)

data class ReceiptItem(
    val name: String,
    val nameVi: String?,
    val nameEn: String?,
    val quantity: Int,
    val unitPrice: Long,
    val lineTotal: Long,
    val specification: String?,
    val note: String?,
)

data class ReceiptTotals(
    val subtotal: Long,
    val discount: Long?,
    val serviceFee: Long?,
    val total: Long,
    val currency: String,
)

data class ReceiptDocumentV1(
    val receiptType: ReceiptType,
    val generatedAt: String,
    val merchant: ReceiptMerchant,
    val order: ReceiptOrder?,
    val tableSession: ReceiptTableSession?,
    val items: List<ReceiptItem>,
    val totals: ReceiptTotals,
    val note: String?,
    val verificationCode: String?,
)

/** Strict parser: rejects unknown/oversized fields and never accepts HTML or printer bytes. */
object ReceiptDocumentParser {
    fun parse(json: String): ReceiptDocumentV1 {
        require(json.length in 2..MAX_JSON_CHARS) { "Receipt snapshot size is invalid." }
        val root = JSONObject(json)
        root.requireOnly(
            "schemaVersion", "receiptType", "generatedAt", "merchant", "order",
            "tableSession", "items", "totals", "note", "verificationCode",
        )
        require(root.optInt("schemaVersion", -1) == 1) { "Unsupported receipt schema." }
        val receiptType = enumValueOf<ReceiptType>(root.requiredText("receiptType", 32))
        val generatedAt = root.requiredInstant("generatedAt")
        val merchantObject = root.requiredObject("merchant").also {
            it.requireOnly("id", "name", "address", "phone")
        }
        val merchant = ReceiptMerchant(
            id = merchantObject.requiredNumericId("id"),
            name = merchantObject.requiredText("name", 120),
            address = merchantObject.optionalText("address", 300),
            phone = merchantObject.optionalText("phone", 32),
        )
        val order = root.optJSONObject("order")?.let(::parseOrder)
        val tableSession = root.optJSONObject("tableSession")?.let(::parseTableSession)
        require(
            (receiptType == ReceiptType.ORDER_CUSTOMER && order != null && tableSession == null) ||
                (receiptType == ReceiptType.TABLE_BILL && tableSession != null && order == null),
        ) { "Receipt context does not match receipt type." }
        val itemArray = root.optJSONArray("items") ?: error("Receipt items are missing.")
        require(itemArray.length() in 1..500) { "Receipt item count is invalid." }
        val items = (0 until itemArray.length()).map { index ->
            val item = itemArray.optJSONObject(index) ?: error("Receipt item is invalid.")
            item.requireOnly(
                "name", "nameVi", "nameEn", "quantity", "unitPrice", "lineTotal",
                "specification", "note",
            )
            ReceiptItem(
                name = item.requiredText("name", 120),
                nameVi = item.optionalText("nameVi", 120),
                nameEn = item.optionalText("nameEn", 120),
                quantity = item.requiredPositiveInt("quantity"),
                unitPrice = item.requiredNonNegativeLong("unitPrice"),
                lineTotal = item.requiredNonNegativeLong("lineTotal"),
                specification = item.optionalText("specification", 120),
                note = item.optionalText("note", 200),
            )
        }
        val totalsObject = root.requiredObject("totals").also {
            it.requireOnly("subtotal", "discount", "serviceFee", "total", "currency")
        }
        val totals = ReceiptTotals(
            subtotal = totalsObject.requiredNonNegativeLong("subtotal"),
            discount = totalsObject.optionalNonNegativeLong("discount"),
            serviceFee = totalsObject.optionalNonNegativeLong("serviceFee"),
            total = totalsObject.requiredNonNegativeLong("total"),
            currency = totalsObject.requiredText("currency", 8).also { require(it == "VND") },
        )
        return ReceiptDocumentV1(
            receiptType = receiptType,
            generatedAt = generatedAt,
            merchant = merchant,
            order = order,
            tableSession = tableSession,
            items = items,
            totals = totals,
            note = root.optionalText("note", 500),
            verificationCode = root.optionalText("verificationCode", 128),
        )
    }

    private fun parseOrder(value: JSONObject): ReceiptOrder {
        value.requireOnly(
            "id", "orderNo", "orderType", "tableName", "guestCount", "createdAt", "completedAt",
        )
        return ReceiptOrder(
            id = value.requiredNumericId("id"),
            orderNo = value.requiredText("orderNo", 32),
            orderType = value.requiredText("orderType", 32),
            tableName = value.optionalText("tableName", 64),
            guestCount = value.optionalNonNegativeInt("guestCount"),
            createdAt = value.requiredInstant("createdAt"),
            completedAt = value.optionalInstant("completedAt"),
        )
    }

    private fun parseTableSession(value: JSONObject): ReceiptTableSession {
        value.requireOnly("id", "sessionNo", "tableName", "openedAt", "closedAt", "orderNos")
        val orderNosArray = value.optJSONArray("orderNos") ?: error("orderNos are missing.")
        require(orderNosArray.length() <= 1_000)
        return ReceiptTableSession(
            id = value.requiredNumericId("id"),
            sessionNo = value.requiredText("sessionNo", 32),
            tableName = value.requiredText("tableName", 64),
            openedAt = value.requiredInstant("openedAt"),
            closedAt = value.optionalInstant("closedAt"),
            orderNos = (0 until orderNosArray.length()).map {
                orderNosArray.optString(it).also { orderNo -> require(orderNo.length in 1..32) }
            },
        )
    }

    private fun JSONObject.requireOnly(vararg allowed: String) {
        val allowedSet = allowed.toSet()
        require(keys().asSequence().all { it in allowedSet }) { "Receipt contains unsupported fields." }
    }

    private fun JSONObject.requiredObject(key: String): JSONObject = optJSONObject(key)
        ?: error("Missing receipt object: $key")

    private fun JSONObject.requiredText(key: String, max: Int): String = optString(key)
        .takeIf { it.length in 1..max && !it.contains('\u0000') }
        ?: error("Invalid receipt text: $key")

    private fun JSONObject.optionalText(key: String, max: Int): String? = if (isNull(key)) null else
        optString(key).takeIf { it.length <= max && !it.contains('\u0000') }
            ?: error("Invalid receipt text: $key")

    private fun JSONObject.requiredNumericId(key: String): String = requiredText(key, 40)
        .also { require(NUMERIC_ID.matches(it)) }

    private fun JSONObject.requiredInstant(key: String): String = requiredText(key, 40)
        .also { Instant.parse(it) }

    private fun JSONObject.optionalInstant(key: String): String? = optionalText(key, 40)
        ?.also { Instant.parse(it) }

    private fun JSONObject.requiredPositiveInt(key: String): Int = optInt(key, -1)
        .also { require(it > 0) }

    private fun JSONObject.optionalNonNegativeInt(key: String): Int? = if (isNull(key)) null else
        optInt(key, -1).also { require(it >= 0) }

    private fun JSONObject.requiredNonNegativeLong(key: String): Long = optLong(key, -1)
        .also { require(it >= 0) }

    private fun JSONObject.optionalNonNegativeLong(key: String): Long? = if (isNull(key)) null else
        optLong(key, -1).also { require(it >= 0) }

    private const val MAX_JSON_CHARS = 512_000
    private val NUMERIC_ID = Regex("^[0-9]+$")
}
