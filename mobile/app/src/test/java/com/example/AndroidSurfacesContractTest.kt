package com.example

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AndroidSurfacesContractTest {
    private val root = File(System.getProperty("user.dir"))

    @Test
    fun `manifest does not expose widgets or quick settings tiles`() {
        val manifest = File(root, "src/main/AndroidManifest.xml").readText()
        assertTrue(!manifest.contains("android.appwidget.action.APPWIDGET_UPDATE"))
        assertTrue(!manifest.contains("android.service.quicksettings.action.QS_TILE"))
        assertTrue(!File(root, "src/main/java/com/example/widgets/AetherWidgets.kt").exists())
        assertTrue(!File(root, "src/main/java/com/example/tiles/AetherTiles.kt").exists())
    }

    @Test
    fun `wake tutorial uses the application bottom sheet`() {
        val pairing = File(root, "src/main/java/com/example/ui/screens/PairingGateScreen.kt").readText()
        val power = File(root, "src/main/java/com/example/ui/screens/PowerSecurityTab.kt").readText()
        val tutorial = File(root, "src/main/java/com/example/ui/components/WakeOnLanTutorialSheet.kt").readText()

        assertTrue(pairing.contains("WakeOnLanTutorialSheet("))
        assertTrue(power.contains("WakeOnLanTutorialSheet("))
        assertTrue(tutorial.contains("ModalBottomSheet("))
        assertTrue(tutorial.contains("LiquidGlassStrongCard"))
        assertTrue(tutorial.contains("Больше не показывать для этого компьютера"))
    }

    @Test
    fun `wake tutorial key does not switch from endpoint to mac after authentication`() {
        val dashboard = File(root, "src/main/java/com/example/ui/main/MainDashboardScreen.kt").readText()
        val pairing = File(root, "src/main/java/com/example/ui/screens/PairingGateScreen.kt").readText()
        assertTrue(dashboard.contains("pcId = socketManager.accountHostDeviceId ?: \"\${hostConfig.ip}:\${hostConfig.port}\""))
        assertTrue(!dashboard.contains("pcId = hostConfig.macAddress.ifBlank"))
        assertTrue(pairing.contains("wakeTutorialPreferences.isDismissed(\"\${pc.hostIp}:\${pc.hostPort}\")"))
        assertTrue(!pairing.contains("wakeTutorialPreferences.isDismissed(pc.id)"))
    }

    @Test
    fun `deck slider keeps local drag value until server publishes a new value`() {
        val controls = File(root, "src/main/java/com/example/ui/components/AetherDeckControls.kt").readText()
        assertTrue(controls.contains("if (!isDragging) value = serverValue"))
        assertTrue(!controls.contains("remember(control.id, state[\"value\"]"))
    }

    @Test
    fun `orange design system is shared by dashboard pairing and deck`() {
        val colors = File(root, "src/main/java/com/example/ui/theme/Color.kt").readText()
        val backdrop = File(root, "src/main/java/com/example/ui/components/LiquidGlass.kt").readText()
        val pairing = File(root, "src/main/java/com/example/ui/screens/PairingGateScreen.kt").readText()

        assertTrue(colors.contains("AetherViolet = Color(0xFFF9733D)"))
        assertTrue(backdrop.contains("aetherAmbientDrift"))
        assertTrue(pairing.contains("AetherBackdrop(modifier = Modifier.fillMaxSize())"))
    }

    @Test
    fun `appearance settings expose persistent light and dark themes`() {
        val activity = File(root, "src/main/java/com/example/MainActivity.kt").readText()
        val dashboard = File(root, "src/main/java/com/example/ui/main/MainDashboardScreen.kt").readText()
        val dialog = File(root, "src/main/java/com/example/ui/components/AppearanceSettingsDialog.kt").readText()
        val theme = File(root, "src/main/java/com/example/ui/theme/Theme.kt").readText()
        val colors = File(root, "src/main/java/com/example/ui/theme/Color.kt").readText()

        assertTrue(activity.contains("ThemePreferenceStore"))
        assertTrue(activity.contains("getSharedPreferences(\"aether_appearance\", MODE_PRIVATE)"))
        assertTrue(!activity.contains("AetherPreferences.secure(this)"))
        assertTrue(dashboard.contains("AppearanceSettingsDialog("))
        assertTrue(dashboard.contains("AccountSettingsSection("))
        assertTrue(dialog.contains("accountContent: (@Composable () -> Unit)? = null"))
        assertTrue(dialog.contains("AetherThemeMode.DARK"))
        assertTrue(dialog.contains("AetherThemeMode.LIGHT"))
        assertTrue(theme.contains("lightColorScheme("))
        assertTrue(theme.contains("darkColorScheme("))
        assertTrue(!theme.contains("themeMode: AetherThemeMode ="))
        assertTrue(colors.contains("error(\"Aether colors must be provided by AetherTheme\")"))
    }

    @Test
    fun `account is available only through settings and does not alter main layouts`() {
        val dashboard = File(root, "src/main/java/com/example/ui/main/MainDashboardScreen.kt").readText()
        val pairing = File(root, "src/main/java/com/example/ui/screens/PairingGateScreen.kt").readText()
        val account = File(root, "src/main/java/com/example/ui/screens/AccountScreen.kt").readText()

        assertTrue(!dashboard.contains("showAccount"))
        assertTrue(!dashboard.contains("TextButton(onClick = { showAccount"))
        assertTrue(!pairing.contains("onOpenAccount"))
        assertTrue(dashboard.contains("accountHosts = accountHosts"))
        assertTrue(dashboard.contains("onConnectAccountHost = connectAccountHost"))
        assertTrue(pairing.contains("AccountComputerCard(host = host"))
        assertTrue(pairing.contains("SavedComputerCard("))
        assertTrue(account.contains("fun AccountSettingsSection("))
        assertTrue(!account.contains("Dialog(onDismissRequest"))
        assertTrue(!account.contains("LazyColumn"))
    }

    @Test
    fun `glass surfaces inherit readable themed content colors`() {
        val glass = File(root, "src/main/java/com/example/ui/components/LiquidGlass.kt").readText()

        assertTrue(glass.contains("LocalContentColor provides TextPrimary"))
        assertTrue(glass.contains("LocalContentColor provides contentColor"))
    }

    @Test
    fun `external shares require confirmation before privileged remote actions`() {
        val activity = File(root, "src/main/java/com/example/MainActivity.kt").readText()
        val manager = File(root, "src/main/java/com/example/network/PcWebSocketManager.kt").readText()
        val handler = activity.substringAfter("private fun handleShareIntent").substringBefore("private fun confirmPendingShare")

        assertTrue(activity.contains("AlertDialog("))
        assertTrue(activity.contains("confirmPendingShare(pending)"))
        assertTrue(activity.contains("socketManager.authenticatedPeerIdentity"))
        assertTrue(activity.contains("pending.copy(peerIdentity = peerIdentity)"))
        assertTrue(activity.contains("pending.peerIdentity != null && pending.peerIdentity == peerIdentity"))
        assertTrue(activity.contains("sendClipboardForPeer(peerIdentity"))
        assertTrue(activity.contains("sendFileStreamToPcForPeer(peerIdentity"))
        assertTrue(manager.contains("requireTransferConnection(socket, generation, expectedPeerIdentity)"))
        assertTrue(manager.contains("val attemptPeerFingerprint = AtomicReference<String?>(null)"))
        assertTrue(manager.contains("claimAuthenticationCommit()"))
        assertTrue(manager.contains("guestSessionTokenPreferenceKey(attemptHostConfig.ip, attemptHostConfig.port"))
        assertTrue(!manager.contains("activePeerFingerprint"))
        assertTrue(!handler.contains("sendAction("))
        assertTrue(!handler.contains("sendSharedContent("))
        assertTrue(!activity.contains("отправка начнётся автоматически"))
    }
}
