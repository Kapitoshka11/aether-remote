package com.example

import com.example.ui.screens.DeckGridPlacement
import com.example.ui.screens.safeDeckGridPlacement
import org.junit.Assert.assertEquals
import org.junit.Test

class AetherDeckGridPlacementTest {
    @Test
    fun clampsControlsThatFallOutsideTheCurrentGrid() {
        assertEquals(DeckGridPlacement(3, 1), safeDeckGridPlacement(7, 2, 4))
        assertEquals(DeckGridPlacement(0, 4), safeDeckGridPlacement(-2, 8, 4))
        assertEquals(DeckGridPlacement(2, 2), safeDeckGridPlacement(2, 4, 4))
    }
}
