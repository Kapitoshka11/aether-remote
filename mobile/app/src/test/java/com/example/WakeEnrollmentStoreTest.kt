package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.example.wake.WakeEnrollment
import com.example.wake.WakeEnrollmentStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class WakeEnrollmentStoreTest {
    private val preferences = ApplicationProvider.getApplicationContext<Context>()
        .getSharedPreferences("wake_enrollment_test", Context.MODE_PRIVATE)

    @Before fun clear() = preferences.edit().clear().commit().let { Unit }

    @Test fun persistsEnrollmentByTargetAndRefusesCorruptData() {
        val store = WakeEnrollmentStore(preferences)
        val enrollment = WakeEnrollment(
            groupId = "11".repeat(16), targetDeviceId = "22".repeat(16), relayUrl = "https://relay.example",
            certificateJson = "{\"type\":\"wake.membership\"}", ownerPublicKeySpki = "owner"
        )
        store.save(enrollment)
        assertEquals(enrollment, store.get(enrollment.targetDeviceId))
        preferences.edit().putString("wake_enrollment_${enrollment.targetDeviceId}", "bad").commit()
        assertNull(store.get(enrollment.targetDeviceId))
    }

    @Test fun rejectsCleartextAndAmbiguousRelayUrls() {
        val store = WakeEnrollmentStore(preferences)
        fun enrollment(url: String) = WakeEnrollment(
            groupId = "11".repeat(16), targetDeviceId = "22".repeat(16), relayUrl = url,
            certificateJson = "{\"type\":\"wake.membership\"}", ownerPublicKeySpki = "owner"
        )
        assertThrows(IllegalArgumentException::class.java) { store.save(enrollment("http://relay.example")) }
        assertThrows(IllegalArgumentException::class.java) { store.save(enrollment("https://user@relay.example")) }
        assertThrows(IllegalArgumentException::class.java) { store.save(enrollment("https://relay.example?redirect=http://127.0.0.1")) }
        store.save(enrollment("http://127.0.0.1:8080"))
        assertEquals("http://127.0.0.1:8080", store.get("22".repeat(16))?.relayUrl)
    }
}
