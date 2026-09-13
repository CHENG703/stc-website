package top.stcwork.filemanager

import android.app.Application
import top.stcwork.filemanager.data.Prefs

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Prefs.init(this)
    }
}
