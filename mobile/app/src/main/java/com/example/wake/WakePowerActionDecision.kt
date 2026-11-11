package com.example.wake

enum class WakePowerAction { SHOW_TUTORIAL, SEND_WAKE }

object WakePowerActionDecision {
    fun forPc(tutorialDismissed: Boolean): WakePowerAction =
        if (tutorialDismissed) WakePowerAction.SEND_WAKE else WakePowerAction.SHOW_TUTORIAL
}
