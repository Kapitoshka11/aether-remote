package com.example.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal class ReconnectScheduler(private val scope: CoroutineScope) {
    private var job: Job? = null
    private val lock = Any()
    val isScheduled: Boolean get() = synchronized(lock) { job != null }

    fun cancel() = synchronized(lock) { job?.cancel(); job = null }

    fun schedule(delayMillis: Long, attempt: suspend () -> Unit) {
        val scheduled = synchronized(lock) {
            if (job != null) return
            lateinit var next: Job
            next = scope.launch(start = CoroutineStart.LAZY) {
                delay(delayMillis)
                val current = synchronized(lock) {
                    if (job !== next) false else { job = null; true }
                }
                // A synchronous failure in attempt may immediately schedule the next retry.
                if (current) attempt()
            }
            job = next
            next
        }
        scheduled.start()
    }
}
