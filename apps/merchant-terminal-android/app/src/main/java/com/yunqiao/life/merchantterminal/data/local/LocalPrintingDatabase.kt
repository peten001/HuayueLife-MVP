package com.yunqiao.life.merchantterminal.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        LocalPrintJobEntity::class,
        LocalPrintAttemptEntity::class,
        PrinterBindingEntity::class,
        TerminalStateEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class LocalPrintingDatabase : RoomDatabase() {
    abstract fun printingDao(): LocalPrintingDao

    companion object {
        @Volatile private var instance: LocalPrintingDatabase? = null

        fun get(context: Context): LocalPrintingDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                LocalPrintingDatabase::class.java,
                "terminal_printing_v1.db",
            ).build().also { instance = it }
        }
    }
}
