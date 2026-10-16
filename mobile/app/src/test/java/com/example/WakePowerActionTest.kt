package com.example

import com.example.wake.WakePowerAction
import com.example.wake.WakePowerActionDecision
import org.junit.Assert.assertEquals
import org.junit.Test

class WakePowerActionTest {
    @Test
    fun firstPressShowsTutorialBeforeSendingWake() {
        assertEquals(WakePowerAction.SHOW_TUTORIAL, WakePowerActionDecision.forPc(tutorialDismissed = false))
    }

    @Test
    fun dismissedTutorialSendsWakeImmediately() {
        assertEquals(WakePowerAction.SEND_WAKE, WakePowerActionDecision.forPc(tutorialDismissed = true))
    }
}
