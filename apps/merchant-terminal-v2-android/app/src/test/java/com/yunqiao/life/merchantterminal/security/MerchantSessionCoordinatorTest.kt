package com.yunqiao.life.merchantterminal.security

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

@RunWith(RobolectricTestRunner::class)
class MerchantSessionCoordinatorTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var store: MerchantSessionTokenStore
    private var starts = 0
    private var shutdowns = 0
    private lateinit var coordinator: MerchantSessionCoordinator

    @Before
    fun setUp() {
        context.getSharedPreferences("merchant_session_token_encrypted", Context.MODE_PRIVATE)
            .edit().clear().commit()
        store = MerchantSessionTokenStore(context, MemoryKeyAccess())
        coordinator = MerchantSessionCoordinator(
            tokenStore = store,
            startConnector = { starts += 1 },
            shutdown = {
                shutdowns += 1
                store.clear()
            },
        )
    }

    @After
    fun tearDown() = store.clear()

    @Test
    fun `persistent Web session is encrypted and starts connector`() = runBlocking {
        val token = "aaaaaaaa.bbbbbbbb.cccccccc"

        val result = coordinator.applyObservation(
            coordinator.beginObservation(),
            MerchantWebSessionSnapshot.Authenticated(
                token,
                MerchantWebSessionPersistence.PERSISTENT,
            ),
        )

        assertEquals(MerchantSessionApplyResult.APPLIED, result)
        assertEquals(token, store.read())
        assertTrue(store.isPersistent())
        assertEquals(1, starts)
        assertEquals(0, shutdowns)
    }

    @Test
    fun `session storage Web session stays process only`() = runBlocking {
        coordinator.applyObservation(
            coordinator.beginObservation(),
            MerchantWebSessionSnapshot.Authenticated(
                "aaaaaaaa.bbbbbbbb.dddddddd",
                MerchantWebSessionPersistence.PROCESS,
            ),
        )

        assertFalse(store.isPersistent())
        assertEquals(1, starts)
    }

    @Test
    fun `newer sign out invalidates an older authentication callback`() = runBlocking {
        val oldAuthentication = coordinator.beginObservation()
        val signOut = coordinator.beginObservation()

        val staleResult = coordinator.applyObservation(
            oldAuthentication,
            MerchantWebSessionSnapshot.Authenticated(
                "aaaaaaaa.bbbbbbbb.eeeeeeee",
                MerchantWebSessionPersistence.PERSISTENT,
            ),
        )
        coordinator.applyObservation(signOut, MerchantWebSessionSnapshot.SignedOut)

        assertEquals(MerchantSessionApplyResult.IGNORED_STALE, staleResult)
        assertNull(store.read())
        assertEquals(0, starts)
        assertEquals(1, shutdowns)
    }

    @Test
    fun `invalid observation shuts down and clears the native session`() = runBlocking {
        store.save("aaaaaaaa.bbbbbbbb.ffffffff", persistent = true)

        coordinator.applyObservation(
            coordinator.beginObservation(),
            MerchantWebSessionSnapshot.Invalid,
        )

        assertNull(store.read())
        assertEquals(0, starts)
        assertEquals(1, shutdowns)
    }

    @Test
    fun `continuous signed out observations perform shutdown only once`() = runBlocking {
        coordinator.applyObservation(
            coordinator.beginObservation(),
            MerchantWebSessionSnapshot.SignedOut,
        )
        coordinator.applyObservation(
            coordinator.beginObservation(),
            MerchantWebSessionSnapshot.SignedOut,
        )
        coordinator.applyObservation(
            coordinator.beginObservation(),
            MerchantWebSessionSnapshot.Invalid,
        )

        assertEquals(1, shutdowns)
        assertEquals(0, starts)
    }

    @Test
    fun `same authenticated session does not repeatedly start connector`() = runBlocking {
        val snapshot = MerchantWebSessionSnapshot.Authenticated(
            "aaaaaaaa.bbbbbbbb.gggggggg",
            MerchantWebSessionPersistence.PERSISTENT,
        )

        coordinator.applyObservation(coordinator.beginObservation(), snapshot)
        coordinator.applyObservation(coordinator.beginObservation(), snapshot)

        assertEquals(1, starts)
        assertEquals(0, shutdowns)
    }

    @Test
    fun `sign out arriving during connector start wins and shuts down once`() = runBlocking {
        val startEntered = CompletableDeferred<Unit>()
        val finishStart = CompletableDeferred<Unit>()
        coordinator = MerchantSessionCoordinator(
            tokenStore = store,
            startConnector = {
                starts += 1
                startEntered.complete(Unit)
                finishStart.await()
            },
            shutdown = {
                shutdowns += 1
                store.clear()
            },
        )
        val authentication = coordinator.beginObservation()
        val authenticationResult = async {
            coordinator.applyObservation(
                authentication,
                MerchantWebSessionSnapshot.Authenticated(
                    "aaaaaaaa.bbbbbbbb.hhhhhhhh",
                    MerchantWebSessionPersistence.PERSISTENT,
                ),
            )
        }
        startEntered.await()
        val signOut = coordinator.beginObservation()
        val signOutResult = async {
            coordinator.applyObservation(signOut, MerchantWebSessionSnapshot.SignedOut)
        }

        finishStart.complete(Unit)

        assertEquals(MerchantSessionApplyResult.IGNORED_STALE, authenticationResult.await())
        assertEquals(MerchantSessionApplyResult.APPLIED, signOutResult.await())
        assertNull(store.read())
        assertEquals(1, starts)
        assertEquals(1, shutdowns)
    }

    @Test
    fun `start exception fails closed and same session is not retried by polling`() = runBlocking {
        val snapshot = MerchantWebSessionSnapshot.Authenticated(
            "aaaaaaaa.bbbbbbbb.iiiiiiii",
            MerchantWebSessionPersistence.PERSISTENT,
        )
        coordinator = MerchantSessionCoordinator(
            tokenStore = store,
            startConnector = {
                starts += 1
                error("USB inspection failed")
            },
            shutdown = {
                shutdowns += 1
                store.clear()
            },
        )

        val result = coordinator.applyObservation(coordinator.beginObservation(), snapshot)
        val repeatedResult = coordinator.applyObservation(coordinator.beginObservation(), snapshot)

        assertEquals(MerchantSessionApplyResult.FAILED_CLOSED, result)
        assertEquals(MerchantSessionApplyResult.APPLIED, repeatedResult)
        assertNull(store.read())
        assertEquals(1, starts)
        assertEquals(1, shutdowns)
    }

    @Test
    fun `credential save exception fails closed`() = runBlocking {
        val oversizedSegment = "j".repeat(1_500)
        val result = coordinator.applyObservation(
            coordinator.beginObservation(),
            MerchantWebSessionSnapshot.Authenticated(
                "$oversizedSegment.$oversizedSegment.$oversizedSegment",
                MerchantWebSessionPersistence.PERSISTENT,
            ),
        )

        assertEquals(MerchantSessionApplyResult.FAILED_CLOSED, result)
        assertNull(store.read())
        assertEquals(0, starts)
        assertEquals(1, shutdowns)
    }

    private class MemoryKeyAccess : MerchantSessionKeyAccess {
        private var key: SecretKey? = null

        override fun getOrCreate(): SecretKey = key ?: KeyGenerator.getInstance("AES")
            .apply { init(256) }
            .generateKey()
            .also { key = it }

        override fun existing(): SecretKey? = key

        override fun delete() {
            key = null
        }
    }
}
