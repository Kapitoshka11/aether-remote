package com.example

import com.example.network.ReconnectScheduler
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.advanceUntilIdle
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ReconnectSchedulerTest {
    @Test
    fun immediateFailureCanScheduleAnotherRetry() = runTest {
        val scheduler = ReconnectScheduler(this)
        var attempts = 0
        scheduler.schedule(1) {
            attempts++
            scheduler.schedule(1) { attempts++ }
        }
        advanceUntilIdle()
        assertEquals(2, attempts)
    }

    @Test
    fun cancelAndDuplicateSchedulingDoNotConnect() = runTest {
        val scheduler = ReconnectScheduler(this)
        var attempts = 0
        scheduler.schedule(1) { attempts++ }
        scheduler.schedule(1) { attempts++ }
        scheduler.cancel()
        advanceUntilIdle()
        assertEquals(0, attempts)
        scheduler.schedule(1) { attempts++ }
        advanceUntilIdle()
        assertEquals(1, attempts)
    }
}
