package com.soyeb.ieltspractice

import android.app.Application

class IeltsApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
