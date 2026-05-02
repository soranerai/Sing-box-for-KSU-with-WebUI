#!/system/bin/sh

ui_print "- Создание рабочей директории..."
mkdir -p /data/adb/sing-box

ui_print "- Настройка прав доступа..."
# Основной бинарник и системные скрипты
chmod 0755 "$MODPATH/sing-box"
chmod 0755 "$MODPATH/action.sh"
chmod 0755 "$MODPATH/service.sh"
chmod 0755 "$MODPATH/autoupdater.sh" 2>/dev/null
chmod 0755 "$MODPATH/stat_daemon.sh" 2>/dev/null

# Рекурсивная настройка WebUI (папки 755, файлы 644)
find "$MODPATH/webroot" -type d -exec chmod 0755 {} +
find "$MODPATH/webroot" -type f -exec chmod 0644 {} +

ui_print "- Установка успешно завершена!"
ui_print "- Откройте карточку модуля для управления."