package com.yunqiao.life.merchantterminal.storage

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        LocalPrinterBindingEntity::class,
        PendingBindingOperationEntity::class,
        PendingStatusReportEntity::class,
        PrintExecutionLedgerEntity::class,
    ],
    version = 2,
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
                ).addMigrations(MIGRATION_1_2).build().also { instance = it }
            }

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("ALTER TABLE print_execution_ledger ADD COLUMN renderedPayloadSha256 TEXT")
            }
        }
    }
}
