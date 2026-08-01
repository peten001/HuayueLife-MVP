package com.yunqiao.life.merchantterminal

import android.app.Application
import com.yunqiao.life.merchantterminal.network.TerminalV2ApiClient
import com.yunqiao.life.merchantterminal.recovery.V2RecoveryScheduler
import com.yunqiao.life.merchantterminal.security.MerchantSessionTokenStore
import com.yunqiao.life.merchantterminal.security.TerminalIdentityStore
import com.yunqiao.life.merchantterminal.security.V2CredentialStore
import com.yunqiao.life.merchantterminal.storage.PrintingRepository
import com.yunqiao.life.merchantterminal.storage.V2PrintingDatabase

class TerminalApplication : Application() {
    lateinit var graph: TerminalGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = TerminalGraph(this)
        if (graph.credentialStore.readCredential()?.isUsable() == true) {
            V2RecoveryScheduler.schedule(this, "application-start")
        }
    }
}

class TerminalGraph(application: Application) {
    val merchantSessionTokenStore = MerchantSessionTokenStore(application)
    val credentialStore = V2CredentialStore(application)
    val identityStore = TerminalIdentityStore(application)
    val api = TerminalV2ApiClient()
    val database = V2PrintingDatabase.get(application)
    val printingRepository = PrintingRepository(database)
    val sessionController = TerminalSessionController(
        application,
        api,
        identityStore,
        credentialStore,
    )
}
