package com.yunqiao.life.merchantterminal.security

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CanonicalReceiptHashTest {
    @Test
    fun matches_server_canonical_json_regardless_of_object_key_order() {
        val first = JSONObject(
            """{"b":2,"a":{"z":"Phở bò","a":[3,true,null,"少辣"]}}""",
        )
        val reordered = JSONObject(
            """{"a":{"a":[3,true,null,"少辣"],"z":"Phở bò"},"b":2}""",
        )
        val expectedCanonical =
            """{"a":{"a":[3,true,null,"少辣"],"z":"Phở bò"},"b":2}"""
        val expectedHash = "9f0a6436f4d8e494614e2877645c685981bd5b037dde79367f3a43c1f7acb956"

        assertEquals(expectedCanonical, CanonicalReceiptHash.canonicalize(first))
        assertEquals(expectedHash, CanonicalReceiptHash.compute(first))
        assertEquals(expectedHash, CanonicalReceiptHash.compute(reordered))
        assertTrue(CanonicalReceiptHash.matches(reordered, expectedHash))
    }

    @Test
    fun tampered_receipt_content_does_not_match_the_authenticated_hash() {
        val original = JSONObject("""{"items":[{"name":"茶","quantity":1}],"total":10000}""")
        val tampered = JSONObject("""{"items":[{"name":"茶","quantity":2}],"total":10000}""")
        val originalHash = CanonicalReceiptHash.compute(original)

        assertTrue(CanonicalReceiptHash.matches(original, originalHash))
        assertFalse(CanonicalReceiptHash.matches(tampered, originalHash))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejects_floating_point_values_outside_the_receipt_integer_schema() {
        CanonicalReceiptHash.compute(JSONObject("""{"total":1.5}"""))
    }
}
