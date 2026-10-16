const fs = require('node:fs');
const path = require('node:path');

const templates = {
  confirmation: {
    subject: 'Подтвердите почту — Aether Remote',
    preview: 'Остался один шаг, чтобы связать телефон и компьютер.',
    title: 'Ваши устройства. Один аккаунт.',
    body: 'Подтвердите адрес <strong>{{ .Email }}</strong>, чтобы войти в Aether Remote и подключать телефон к своим компьютерам.',
    button: 'Подтвердить почту',
    note: 'Откройте ссылку на том устройстве, где создали аккаунт. На ПК оставьте приложение открытым и перейдите по ссылке в течение 10 минут.',
    footer: 'Не создавали аккаунт? Просто проигнорируйте это письмо.'
  },
  recovery: {
    subject: 'Восстановление пароля — Aether Remote',
    preview: 'Задайте новый пароль и вернитесь к своим устройствам.',
    title: 'Вернём доступ к аккаунту',
    body: 'Получен запрос на восстановление пароля для <strong>{{ .Email }}</strong>. Нажмите кнопку, затем задайте новый пароль в приложении.',
    button: 'Задать новый пароль',
    note: 'Откройте ссылку на том устройстве, где запросили восстановление. На ПК оставьте приложение открытым и перейдите по ссылке в течение 10 минут.',
    footer: 'Не запрашивали восстановление? Игнорируйте письмо. Ваш пароль останется прежним.'
  },
  password_changed: {
    subject: 'Пароль изменён — Aether Remote',
    preview: 'Уведомление о безопасности вашего аккаунта.',
    title: 'Пароль успешно изменён',
    body: 'Пароль аккаунта <strong>{{ .Email }}</strong> изменён. При следующем входе используйте новый пароль.',
    note: 'Если это были не вы, откройте Aether Remote и выберите «Восстановить пароль». После восстановления проверьте список устройств и отзовите доступ у незнакомых.',
    footer: 'Смена пароля сама по себе не отзывает ранее доверенные устройства.'
  }
};

function render(t) {
  const link = '{{ .ConfirmationURL }}';
  return `<!doctype html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t.subject}</title></head>
<body style="margin:0;padding:0;background:#f4f3f0;color:#232321;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${t.preview}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f3f0;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e8e5df;border-radius:20px;">
<tr><td style="padding:30px 24px 24px;border-bottom:1px solid #eeeae4;"><span style="font-size:20px;letter-spacing:-0.5px;font-weight:bold;color:#232321;">aether<span style="color:#c34c20;">.</span></span><span style="font-size:12px;letter-spacing:2px;color:#68645d;"> &nbsp; REMOTE</span></td></tr>
<tr><td style="padding:28px 24px 12px;"><h1 style="margin:0 0 20px;font-size:28px;line-height:1.2;letter-spacing:-0.5px;">${t.title}</h1><p style="margin:0;font-size:16px;line-height:1.65;overflow-wrap:anywhere;word-break:break-word;">${t.body}</p></td></tr>
${t.button ? `<tr><td style="padding:16px 24px 24px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#f9733d" style="border-radius:12px;background:#f9733d;text-align:center;"><a href="${link}" style="display:inline-block;padding:16px 22px;border:1px solid #f9733d;border-radius:12px;color:#25170e;font-size:16px;line-height:1.3;font-weight:bold;text-decoration:none;">${t.button}</a></td></tr></table></td></tr>` : ''}
<tr><td style="padding:8px 24px 24px;"><p style="margin:0;padding:16px;background:#f8f6f2;border-radius:12px;font-size:14px;line-height:1.6;color:#534d43;">${t.note}</p></td></tr>
${t.button ? `<tr><td style="padding:0 24px 24px;"><p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#68645d;">Кнопка не работает? Скопируйте ссылку в браузер. Если она устарела, запросите новое письмо в приложении.</p><a href="${link}" style="font-size:12px;line-height:1.6;color:#a43f18;overflow-wrap:anywhere;word-break:break-all;">${link}</a></td></tr>` : ''}
<tr><td style="padding:20px 24px;border-top:1px solid #eeeae4;"><p style="margin:0;font-size:13px;line-height:1.6;color:#68645d;">${t.footer}</p></td></tr>
</table><p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#68645d;">Aether Remote · Телефон и компьютер рядом</p>
</td></tr></table></body></html>
`;
}

const target = path.join(__dirname, '../supabase/templates');
fs.mkdirSync(target, { recursive: true });
for (const [name, template] of Object.entries(templates)) {
  fs.writeFileSync(path.join(target, `${name}.html`), render(template), 'utf8');
}
const config = {
  mailer_subjects_confirmation: templates.confirmation.subject,
  mailer_templates_confirmation_content: render(templates.confirmation),
  mailer_subjects_recovery: templates.recovery.subject,
  mailer_templates_recovery_content: render(templates.recovery),
  mailer_notifications_password_changed_enabled: true,
  mailer_subjects_password_changed_notification: templates.password_changed.subject,
  mailer_templates_password_changed_notification_content: render(templates.password_changed)
};
fs.writeFileSync(path.join(target, 'hosted-auth-config.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log('Generated three Russian email templates and hosted Auth configuration. Remote settings are unchanged.');
