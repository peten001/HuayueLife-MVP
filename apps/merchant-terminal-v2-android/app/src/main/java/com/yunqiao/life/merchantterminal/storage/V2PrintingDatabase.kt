package com.yunqiao.life.merchantterminal.storage

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        LocalPrinterBindingEntity::class,
        PendingBindingOperationEntity::class,
        PendingStatusReportEntity::class,
        PrintExecutionLedgerEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class V2PrintingDatabase : RoomDatabase() {
    abstract fun printingDao(): V2PrintingDao

    companion object {
        const val DATABASE_NAME = "terminal_printing_v2.db"

        @Volatile
        private var instance: V2PrintingDatabase? = null

        fun get(context: Context): V2PrintingDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    V2PrintingDatabase::class.java,
                    DATABASE_NAME,
                ).build().also { instance = it }
            }
    }
}
