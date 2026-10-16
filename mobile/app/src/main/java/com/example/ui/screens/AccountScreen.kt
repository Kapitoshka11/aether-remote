package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.account.AccountDevice
import com.example.account.AccountRepository
import com.example.account.AccountState
import com.example.ui.components.LiquidGlassButton
import com.example.ui.components.LiquidGlassCard
import com.example.ui.theme.AetherViolet
import com.example.ui.theme.GlassBorderTopLight
import com.example.ui.theme.GlassWhiteLight
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary

@Composable
fun AccountSettingsSection(
    repository: AccountRepository,
    onConnect: (AccountDevice) -> Unit,
    onSignOut: () -> Unit
) {
    val state by repository.state.collectAsState()
    var expanded by rememberSaveable { mutableStateOf(false) }

    LiquidGlassCard(
        modifier = Modifier
            .fillMaxWidth()
            .animateContentSize(),
        shape = RoundedCornerShape(22.dp)
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded = !expanded }
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .background(AetherViolet.copy(alpha = 0.16f), RoundedCornerShape(14.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.AccountCircle, contentDescription = null, tint = AetherViolet)
                }
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Аккаунт", color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    Text(
                        state.profile?.email ?: "Вход, синхронизация и доверенные устройства",
                        color = TextMuted,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Icon(
                    Icons.Default.ExpandMore,
                    contentDescription = if (expanded) "Свернуть аккаунт" else "Открыть аккаунт",
                    tint = TextMuted,
                    modifier = Modifier.graphicsLayer { rotationZ = if (expanded) 180f else 0f }
                )
            }

            AnimatedVisibility(expanded) {
                Column {
                    Box(Modifier.fillMaxWidth().height(1.dp).background(GlassBorderTopLight))
                    AccountPanelContent(
                        state = state,
                        onConnect = onConnect,
                        onAction = { action, email, password ->
                            when (action) {
                                "sign-in" -> repository.signIn(email, password)
                                "sign-up" -> repository.signUp(email, password)
                                "recover" -> repository.recover(email)
                                "update-password" -> repository.updatePassword(password)
                                "sign-out" -> {
                                    onSignOut()
                                    repository.signOut()
                                }
                                "refresh" -> repository.refresh()
                                "revoke" -> repository.revoke(email)
                                "rename" -> repository.rename(email, password)
                            }
                        }
                    )
                }
            }
        }
    }
}

@Composable
fun AccountPanelContent(
    state: AccountState,
    onConnect: (AccountDevice) -> Unit,
    onAction: (String, String, String) -> Unit
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var revoke by remember { mutableStateOf<AccountDevice?>(null) }
    var rename by remember { mutableStateOf<AccountDevice?>(null) }
    var name by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (!state.persistent) {
            AccountNotice("Вход сохранится только до закрытия приложения: защищённое хранилище недоступно.")
        }
        state.message?.let { AccountNotice(it, accent = true) }
        if (state.busy) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth().clip(CircleShape),
                color = AetherViolet,
                trackColor = GlassWhiteLight
            )
        }

        if (state.passwordRecovery) {
            Text("Новый пароль", color = TextPrimary, fontWeight = FontWeight.SemiBold)
            AccountTextField(password, { password = it.take(1024) }, "Пароль", password = true)
            AccountPrimaryButton(
                text = "Сохранить пароль",
                enabled = !state.busy && password.length >= 8,
                onClick = {
                    onAction("update-password", "", password)
                    password = ""
                }
            )
        } else if (state.profile == null) {
            Text(
                "Один аккаунт связывает телефон и компьютер. Первый доступ подтверждается на ПК.",
                color = TextSecondary,
                fontSize = 12.sp,
                lineHeight = 17.sp
            )
            AccountTextField(email, { email = it.take(254) }, "Почта", keyboardType = KeyboardType.Email)
            AccountTextField(password, { password = it.take(1024) }, "Пароль", password = true)
            AccountPrimaryButton(
                text = "Войти",
                enabled = !state.busy,
                icon = { Icon(Icons.AutoMirrored.Filled.Login, contentDescription = null, modifier = Modifier.size(17.dp)) },
                onClick = {
                    onAction("sign-in", email, password)
                    password = ""
                }
            )
            LiquidGlassButton(
                onClick = {
                    onAction("sign-up", email, password)
                    password = ""
                },
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp)
            ) {
                Text("Создать аккаунт", color = TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
            TextButton(
                onClick = { onAction("recover", email, "") },
                enabled = !state.busy,
                modifier = Modifier.align(Alignment.CenterHorizontally)
            ) {
                Text("Восстановить пароль", color = AetherViolet, fontSize = 12.sp)
            }
            Text(
                "Без входа приложение продолжает работать как раньше: подключайтесь по QR-коду или адресу ПК.",
                color = TextMuted,
                fontSize = 11.sp,
                lineHeight = 15.sp
            )
        } else {
            Column {
                Text(
                    state.profile.email,
                    color = TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    if (state.offline) "Облако недоступно — локальные доверенные ПК остаются доступны."
                    else "Устройства синхронизированы",
                    color = TextMuted,
                    fontSize = 11.sp,
                    lineHeight = 15.sp
                )
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AccountSecondaryButton(
                    text = "Обновить",
                    icon = { Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp)) },
                    enabled = !state.busy,
                    modifier = Modifier.weight(1f),
                    onClick = { onAction("refresh", "", "") }
                )
                AccountSecondaryButton(
                    text = "Выйти",
                    icon = { Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(16.dp)) },
                    enabled = !state.busy,
                    modifier = Modifier.weight(1f),
                    onClick = { onAction("sign-out", "", "") }
                )
            }

            if (state.devices.isEmpty()) {
                AccountNotice("Войдите в этот же аккаунт на компьютере — он появится здесь.")
            }
            state.devices.forEach { device ->
                DeviceCard(
                    device = device,
                    busy = state.busy,
                    onConnect = { onConnect(device) },
                    onRename = {
                        rename = device
                        name = device.name
                    },
                    onRevoke = { revoke = device }
                )
            }
        }
    }

    revoke?.let { device ->
        AlertDialog(
            onDismissRequest = { revoke = null },
            title = { Text("Отозвать ${device.name}?") },
            text = { Text("Устройство потеряет доступ. Компьютер без интернета применит отзыв после возвращения в сеть.") },
            confirmButton = {
                TextButton(onClick = {
                    onAction("revoke", device.id, "")
                    revoke = null
                }) { Text("Отозвать", color = AetherViolet) }
            },
            dismissButton = { TextButton(onClick = { revoke = null }) { Text("Отмена") } }
        )
    }
    rename?.let { device ->
        AlertDialog(
            onDismissRequest = { rename = null },
            title = { Text("Название устройства") },
            text = { AccountTextField(name, { name = it.take(80) }, "Название") },
            confirmButton = {
                TextButton(
                    enabled = name.isNotBlank(),
                    onClick = {
                        onAction("rename", device.id, name)
                        rename = null
                    }
                ) { Text("Сохранить", color = AetherViolet) }
            },
            dismissButton = { TextButton(onClick = { rename = null }) { Text("Отмена") } }
        )
    }
}

@Composable
private fun AccountTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    password: Boolean = false,
    keyboardType: KeyboardType = if (password) KeyboardType.Password else KeyboardType.Text
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = AetherViolet,
            unfocusedBorderColor = GlassBorderTopLight,
            focusedLabelColor = AetherViolet,
            unfocusedLabelColor = TextMuted,
            focusedTextColor = TextPrimary,
            unfocusedTextColor = TextPrimary,
            cursorColor = AetherViolet
        )
    )
}

@Composable
private fun AccountPrimaryButton(
    text: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    icon: (@Composable () -> Unit)? = null,
    onClick: () -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth().height(48.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = AetherViolet,
            contentColor = Color.White,
            disabledContainerColor = AetherViolet.copy(alpha = 0.32f)
        )
    ) {
        icon?.invoke()
        if (icon != null) Spacer(Modifier.size(7.dp))
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun AccountSecondaryButton(
    text: String,
    icon: @Composable () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    LiquidGlassButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 11.dp)
    ) {
        icon()
        Spacer(Modifier.size(6.dp))
        Text(text, color = TextPrimary, fontSize = 11.sp)
    }
}

@Composable
private fun AccountNotice(text: String, accent: Boolean = false) {
    Text(
        text,
        color = if (accent) AetherViolet else TextSecondary,
        fontSize = 11.sp,
        lineHeight = 15.sp,
        modifier = Modifier.fillMaxWidth().background(GlassWhiteLight, RoundedCornerShape(14.dp)).padding(12.dp)
    )
}

@Composable
private fun DeviceCard(
    device: AccountDevice,
    busy: Boolean,
    onConnect: () -> Unit,
    onRename: () -> Unit,
    onRevoke: () -> Unit
) {
    LiquidGlassCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(36.dp).background(AetherViolet.copy(alpha = 0.14f), RoundedCornerShape(12.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Computer, contentDescription = null, tint = AetherViolet, modifier = Modifier.size(19.dp))
                }
                Spacer(Modifier.size(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(device.name, color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        if (device.revoked) "Доступ отозван" else if (device.kind == "host") "Компьютер" else "Телефон",
                        color = TextMuted,
                        fontSize = 10.sp
                    )
                }
            }
            if (device.kind == "host" && !device.revoked) {
                AccountPrimaryButton("Подключиться", enabled = !busy, onClick = onConnect)
            }
            if (!device.revoked) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AccountSecondaryButton(
                        "Название",
                        { Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(15.dp)) },
                        enabled = !busy,
                        modifier = Modifier.weight(1f),
                        onClick = onRename
                    )
                    AccountSecondaryButton(
                        "Отозвать",
                        { Icon(Icons.Default.Block, contentDescription = null, modifier = Modifier.size(15.dp)) },
                        enabled = !busy,
                        modifier = Modifier.weight(1f),
                        onClick = onRevoke
                    )
                }
            }
        }
    }
}
