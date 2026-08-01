package com.yunqiao.life.merchantterminal.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

internal object YunQiaoUiTokens {
    val Ink = Color(0xFF0B1B2D)
    val BodyColor = Color(0xFF415169)
    val Muted = Color(0xFF738096)
    val White = Color(0xFFFFFFFF)
    val Danger = Color(0xFFFC4548)
    val Warning = Color(0xFFE99000)
    val Information = Color(0xFF2184E8)

    object Overview {
        val Page = Color(0xFFF5F8F7)
        val Green = Color(0xFF009B62)
        val Mint = Color(0xFFE3FAED)
        val Border = Color(0xFFE4E9ED)
    }

    object Service {
        val Page = Color(0xFFF5F7F8)
        val Green = Color(0xFF019560)
        val SuccessBorder = Color(0xFFC3E9DA)
        val Info = Color(0xFFF1F7FD)
        val InfoBorder = Color(0xFFC6DFFA)
        val Border = Color(0xFFE5E9EC)
    }

    object Type {
        val Green = Color(0xFF0F7943)
        val Selected = Color(0xFFEFF7F2)
        val Border = Color(0xFFE4E6EA)
        val Divider = Color(0xFFE8E9ED)
    }

    object LanDiscovery {
        val Green = Color(0xFF019A5F)
        val Discovery = Color(0xFFF3F9F7)
        val Neutral = Color(0xFFEBEFF2)
    }

    object LanSuccess {
        val Green = Color(0xFF018F5E)
        val Success = Color(0xFFDFF9F0)
        val SuccessIcon = Color(0xFF01B776)
        val Border = Color(0xFFE7ECF0)
    }

    object Usb {
        val Green = Color(0xFF018F5B)
        val Selected = Color(0xFFDAF4E9)
        val Border = Color(0xFFE6EAED)
    }

    object Bluetooth {
        val Green = Color(0xFF01A064)
        val Selected = Color(0xFFF0FCF6)
        val Neutral = Color(0xFFEBEEF1)
    }

    object Detail {
        val Green = Color(0xFF00A56A)
        val Page = Color(0xFFF8F9F8)
        val Border = Color(0xFFE7ECF0)
    }

    val Heading02 = TextStyle(
        fontSize = 30.sp,
        lineHeight = 38.sp,
        fontWeight = FontWeight.Bold,
        color = Ink,
    )
    val Heading03 = TextStyle(
        fontSize = 26.sp,
        lineHeight = 34.sp,
        fontWeight = FontWeight.Bold,
        color = Ink,
    )
    val Heading24 = TextStyle(
        fontSize = 24.sp,
        lineHeight = 32.sp,
        fontWeight = FontWeight.Bold,
        color = Ink,
    )
    val Heading22 = TextStyle(
        fontSize = 22.sp,
        lineHeight = 30.sp,
        fontWeight = FontWeight.Bold,
        color = Ink,
    )
    val Heading20 = TextStyle(
        fontSize = 20.sp,
        lineHeight = 28.sp,
        fontWeight = FontWeight.Bold,
        color = Ink,
    )
    val ItemTitle = TextStyle(
        fontSize = 20.sp,
        lineHeight = 27.sp,
        fontWeight = FontWeight.SemiBold,
        color = Ink,
    )
    val Body = TextStyle(
        fontSize = 17.sp,
        lineHeight = 24.sp,
        fontWeight = FontWeight.Normal,
        color = BodyColor,
    )
    val Label = TextStyle(
        fontSize = 16.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.SemiBold,
        color = Ink,
    )
    val Meta = TextStyle(
        fontSize = 15.sp,
        lineHeight = 21.sp,
        fontWeight = FontWeight.Normal,
        color = Muted,
    )
}
