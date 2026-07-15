package com.yunqiao.life.merchantterminal.security

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.math.BigInteger
import java.security.MessageDigest
import kotlin.math.abs

/**
 * Mirrors apps/api/src/modules/printing/utils/snapshot-hash.ts for the bounded V1 receipt schema.
 * Object keys are sorted recursively, array order is retained, and receipt numbers must be safe
 * integers (the server schema does not permit floating-point receipt values).
 */
object CanonicalReceiptHash {
    fun compute(value: Any?): String {
        val state = CanonicalizationState()
        val canonical = state.encode(value, depth = 0)
        return MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    fun matches(value: Any?, expectedLowerHex: String): Boolean {
        if (!SHA256.matches(expectedLowerHex)) return false
        return MessageDigest.isEqual(
            compute(value).toByteArray(Charsets.US_ASCII),
            expectedLowerHex.toByteArray(Charsets.US_ASCII),
        )
    }

    internal fun canonicalize(value: Any?): String =
        CanonicalizationState().encode(value, depth = 0)

    private class CanonicalizationState {
        private var nodes = 0

        fun encode(value: Any?, depth: Int): String {
            require(depth <= MAX_DEPTH) { "Receipt snapshot nesting is too deep." }
            nodes += 1
            require(nodes <= MAX_NODES) { "Receipt snapshot contains too many values." }
            return when (value) {
                null, JSONObject.NULL -> "null"
                is JSONObject -> encodeObject(value, depth)
                is JSONArray -> encodeArray(value, depth)
                is String -> quote(value)
                is Boolean -> value.toString()
                is Number -> encodeSafeInteger(value)
                else -> throw IllegalArgumentException(
                    "Unsupported receipt snapshot value: " + value.javaClass.simpleName,
                )
            }
        }

        private fun encodeObject(value: JSONObject, depth: Int): String {
            val keys = value.keys().asSequence().toList().sorted()
            return keys.joinToString(prefix = "{", postfix = "}", separator = ",") { key ->
                quote(key) + ":" + encode(value.get(key), depth + 1)
            }
        }

        private fun encodeArray(value: JSONArray, depth: Int): String =
            (0 until value.length()).joinToString(prefix = "[", postfix = "]", separator = ",") {
                encode(value.get(it), depth + 1)
            }

        private fun encodeSafeInteger(value: Number): String {
            val integer = when (value) {
                is Byte, is Short, is Int, is Long -> value.toLong()
                is BigInteger -> {
                    require(value.abs() <= MAX_SAFE_INTEGER_BIGINT) {
                        "Receipt number exceeds the JavaScript safe integer range."
                    }
                    return value.toString()
                }
                is BigDecimal -> {
                    val normalized = value.stripTrailingZeros()
                    require(normalized.scale() <= 0) { "Receipt numbers must be integers." }
                    require(normalized.abs() <= MAX_SAFE_INTEGER_DECIMAL) {
                        "Receipt number exceeds the JavaScript safe integer range."
                    }
                    return normalized.toPlainString()
                }
                is Double -> {
                    require(value.isFinite() && value % 1.0 == 0.0 && abs(value) <= MAX_SAFE_INTEGER) {
                        "Receipt number is not a JavaScript safe integer."
                    }
                    value.toLong()
                }
                is Float -> {
                    require(
                        value.isFinite() && value % 1f == 0f &&
                            abs(value).toDouble() <= MAX_SAFE_INTEGER,
                    ) {
                        "Receipt number is not a JavaScript safe integer."
                    }
                    value.toLong()
                }
                else -> {
                    val normalized = value.toString().toBigDecimalOrNull()?.stripTrailingZeros()
                        ?: throw IllegalArgumentException("Receipt number is invalid.")
                    require(normalized.scale() <= 0 && normalized.abs() <= MAX_SAFE_INTEGER_DECIMAL)
                    return normalized.toPlainString()
                }
            }
            require(abs(integer.toDouble()) <= MAX_SAFE_INTEGER) {
                "Receipt number exceeds the JavaScript safe integer range."
            }
            return integer.toString()
        }

        /** JSON.stringify-compatible string escaping, including well-formed lone surrogates. */
        private fun quote(value: String): String = buildString(value.length + 2) {
            append('"')
            var index = 0
            while (index < value.length) {
                val character = value[index]
                when (character) {
                    '"' -> append("\\\"")
                    '\\' -> append("\\\\")
                    '\b' -> append("\\b")
                    '\u000c' -> append("\\f")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> when {
                        character.code < 0x20 -> appendUnicodeEscape(character)
                        character.isHighSurrogate() -> {
                            val low = value.getOrNull(index + 1)
                            if (low?.isLowSurrogate() == true) {
                                append(character)
                                append(low)
                                index += 1
                            } else {
                                appendUnicodeEscape(character)
                            }
                        }
                        character.isLowSurrogate() -> appendUnicodeEscape(character)
                        else -> append(character)
                    }
                }
                index += 1
            }
            append('"')
        }

        private fun StringBuilder.appendUnicodeEscape(value: Char) {
            append("\\u")
            append(value.code.toString(16).padStart(4, '0'))
        }
    }

    private const val MAX_DEPTH = 64
    private const val MAX_NODES = 25_000
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991.0
    private val MAX_SAFE_INTEGER_BIGINT = BigInteger("9007199254740991")
    private val MAX_SAFE_INTEGER_DECIMAL = BigDecimal("9007199254740991")
    private val SHA256 = Regex("^[0-9a-f]{64}$")
}
