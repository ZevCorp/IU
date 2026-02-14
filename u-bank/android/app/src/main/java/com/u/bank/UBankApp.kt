package com.u.bank

import android.app.Application
import android.util.Log

/**
 * UBankApp — Application class for Ü Bank.
 */
class UBankApp : Application() {

    companion object {
        private const val TAG = "UBankApp"
        lateinit var instance: UBankApp
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.i(TAG, "Ü Bank Application initialized")
    }
}
