package com.example

import com.example.network.StreamLifecyclePolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class StreamLifecyclePolicyTest {
    @Test
    fun restoresOnlyStreamsThatWereActiveBeforeBackgrounding() {
        val policy = StreamLifecyclePolicy()

        assertEquals(StreamLifecyclePolicy.Selection(live = true, audio = false), policy.pause(live = true, audio = false))
        assertEquals(StreamLifecyclePolicy.Selection(live = true, audio = false), policy.resume(connected = true))
        assertEquals(StreamLifecyclePolicy.Selection(), policy.resume(connected = true))
    }

    @Test
    fun dropsResumeRequestWhenConnectionWasLost() {
        val policy = StreamLifecyclePolicy()
        policy.pause(live = true, audio = true)

        assertEquals(StreamLifecyclePolicy.Selection(), policy.resume(connected = false))
        assertEquals(StreamLifecyclePolicy.Selection(), policy.resume(connected = true))
    }
}
